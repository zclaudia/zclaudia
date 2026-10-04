import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LanguageServerManager } from '../manager.js';
import { createConfiguredPreset } from '../presets.js';
import { LanguageServerRegistry } from '../registry.js';
import type { LanguageServerPreset } from '../types.js';
import { createFakeServer, type FakeServer } from './fake-lsp-server.js';

function preset(
  id: string,
  extensions: Record<string, string>,
  extra: Partial<LanguageServerPreset> = {}
) {
  return {
    id,
    name: id,
    languages: [...new Set(Object.values(extensions))],
    extensions,
    rootMarkers: [],
    resolveLaunch: (root: string) => ({ command: id, args: [], cwd: root }),
    ...extra,
  } satisfies LanguageServerPreset;
}

async function until(check: () => boolean, timeoutMs = 2000) {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeoutMs) throw new Error('until: timed out');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

describe('LanguageServerRegistry', () => {
  it('orders user > plugin > built in, and an id replaces a lower-priority one', () => {
    const builtinPy = preset('pyright', { '.py': 'python' });
    const builtinTs = preset('typescript', { '.ts': 'typescript' });
    const registry = new LanguageServerRegistry([builtinTs, builtinPy]);
    const pluginLua = preset('lua', { '.lua': 'lua' });
    const userPy = preset('pyright', { '.py': 'python' });
    registry.setPluginPresets('com.example.lua', [pluginLua]);
    registry.setUserPresets([userPy]);

    expect(registry.entries().map(entry => [entry.preset, entry.source, entry.pluginId])).toEqual([
      [userPy, 'user', undefined],
      [pluginLua, 'plugin', 'com.example.lua'],
      [builtinTs, 'builtin', undefined],
    ]);
    registry.removePlugin('com.example.lua');
    registry.setUserPresets([]);
    expect(registry.presets()).toEqual([builtinTs, builtinPy]);
  });

  it('tells listeners about every change', () => {
    const registry = new LanguageServerRegistry([]);
    let changes = 0;
    const off = registry.onChange(() => changes++);
    registry.setUserPresets([]);
    registry.setPluginPresets('p', [preset('x', { '.x': 'x' })]);
    registry.notifyChanged();
    registry.removePlugin('p');
    registry.removePlugin('p'); // nothing to remove: no change
    off();
    registry.notifyChanged();
    expect(changes).toBe(4);
  });
});

describe('LanguageServerManager with a registry', () => {
  let dir: string;
  let servers: FakeServer[];
  const managers: LanguageServerManager[] = [];
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'lsp-registry-'));
    servers = [];
  });
  afterEach(async () => {
    await Promise.all(managers.splice(0).map(manager => manager.dispose()));
    rmSync(dir, { recursive: true, force: true });
  });

  function managerFor(registry: LanguageServerRegistry) {
    const manager = new LanguageServerManager({
      registry,
      settleMs: 10,
      spawn: async launch => {
        const server = createFakeServer();
        servers.push(server);
        (server as FakeServer & { command?: string }).command = launch.command;
        return server.transport;
      },
    });
    managers.push(manager);
    return manager;
  }

  it('lets a higher-priority server claim an extension instead of running both', () => {
    const registry = new LanguageServerRegistry([preset('pyright', { '.py': 'python' })]);
    const manager = managerFor(registry);
    registry.setUserPresets([preset('basedpyright', { '.py': 'python', '.pyi': 'python' })]);
    expect(manager.serversFor(dir).map(s => s.id)).toEqual(['basedpyright']);
    expect(manager.statusFor(dir).map(s => [s.id, s.source])).toEqual([['basedpyright', 'user']]);
  });

  it('stops a running server whose definition changed', async () => {
    const registry = new LanguageServerRegistry([]);
    const manager = managerFor(registry);
    registry.setUserPresets([preset('mine', { '.fk': 'fake' })]);
    manager.acquire(dir, 'run');
    await until(() => manager.status().some(s => s.state === 'ready'));

    registry.setUserPresets([preset('mine', { '.fk': 'fake' }, { name: 'Mine v2' })]);
    await until(() => servers[0].received.some(r => r.method === 'shutdown'));
    expect(manager.status()).toEqual([]);
    expect(manager.statusFor(dir)).toEqual([
      expect.objectContaining({ name: 'Mine v2', state: 'idle' }),
    ]);
  });

  it('holds a plugin server back until its plugin may run commands, and stops it on revoke', async () => {
    let granted = false;
    const registry = new LanguageServerRegistry([]);
    const manager = managerFor(registry);
    writeFileSync(path.join(dir, 'lua.json'), '{}');
    registry.setPluginPresets('com.example.lua', [
      preset(
        'lua',
        { '.lua': 'lua' },
        {
          rootMarkers: ['lua.json'],
          permission: { pluginId: 'com.example.lua', granted: () => granted },
        }
      ),
    ]);
    expect(manager.serversFor(dir)).toEqual([]);
    expect(manager.statusFor(dir)).toEqual([
      expect.objectContaining({
        id: 'lua',
        state: 'needs_permission',
        source: 'plugin',
        pluginId: 'com.example.lua',
      }),
    ]);

    granted = true;
    registry.notifyChanged();
    expect(manager.serversFor(dir).map(s => s.id)).toEqual(['lua']);
    manager.acquire(dir, 'run');
    await until(() => manager.status().some(s => s.state === 'ready'));

    granted = false;
    registry.notifyChanged();
    await until(() => servers[0].received.some(r => r.method === 'shutdown'));
    expect(manager.serversFor(dir)).toEqual([]);
  });
});

describe('createConfiguredPreset', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'lsp-configured-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const config = {
    id: 'clangd',
    name: 'C (clangd)',
    command: 'clangd',
    args: ['--background-index'],
    extensions: { '.c': 'c', '.h': 'c' },
    rootMarkers: ['compile_commands.json'],
    settings: { clangd: { fallbackFlags: ['-std=c11'] } },
  };

  it('starts in workspaces with a root marker, from PATH, with its settings', () => {
    let found: string | null = null;
    const created = createConfiguredPreset(config, { find: () => found });
    writeFileSync(path.join(dir, 'compile_commands.json'), '[]');
    expect(created.resolveLaunch(dir)).toBeNull();
    expect(created.missingReason?.()).toBe('Command not found: clangd');
    found = '/usr/bin/clangd';
    created.refreshDetection?.();
    expect(created.resolveLaunch(dir)).toEqual({
      command: '/usr/bin/clangd',
      args: ['--background-index'],
      cwd: dir,
      settings: { clangd: { fallbackFlags: ['-std=c11'] } },
    });
    expect(created.languages).toEqual(['c']);
  });

  it.skipIf(process.platform === 'win32')(
    'resolves a ./ command inside the plugin directory only',
    () => {
      const pluginDir = path.join(dir, 'plugin');
      mkdirSync(path.join(pluginDir, 'bin'), { recursive: true });
      writeFileSync(path.join(pluginDir, 'bin', 'ls'), '#!/bin/sh\n');
      chmodSync(path.join(pluginDir, 'bin', 'ls'), 0o755);
      writeFileSync(path.join(dir, 'compile_commands.json'), '[]');
      const inside = createConfiguredPreset(
        { ...config, command: './bin/ls' },
        { baseDir: pluginDir }
      );
      expect(inside.resolveLaunch(dir)?.command).toBe(path.join(pluginDir, 'bin', 'ls'));
      const escaping = createConfiguredPreset(
        { ...config, command: '../plugin/bin/ls' },
        { baseDir: path.join(pluginDir, 'bin') }
      );
      expect(escaping.resolveLaunch(dir)).toBeNull();
      // No plugin directory (a user definition): never relative.
      expect(
        createConfiguredPreset({ ...config, command: './bin/ls' }).resolveLaunch(dir)
      ).toBeNull();
    }
  );
});
