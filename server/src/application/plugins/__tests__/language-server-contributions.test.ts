import { describe, expect, it } from 'vitest';
import { pluginEvents } from '../../../infra/events/index.js';
import { LanguageServerRegistry } from '../../../infra/lsp/index.js';
import { registerLanguageServerContributions } from '../language-server-contributions.js';

const declared = [
  {
    id: 'lua',
    name: 'Lua',
    command: './bin/lua-language-server',
    extensions: { '.lua': 'lua' },
    rootMarkers: ['.luarc.json'],
  },
];

describe('registerLanguageServerContributions', () => {
  it('adds the servers as plugin presets gated on shell.execute, and removes them', () => {
    const registry = new LanguageServerRegistry([]);
    let granted = false;
    const result = registerLanguageServerContributions(declared, {
      pluginId: 'com.example.lua',
      pluginPath: '/plugins/lua',
      registry,
      hasPermission: () => granted,
    });
    expect(result.ok).toBe(true);
    const [entry] = registry.entries();
    expect(entry).toMatchObject({ source: 'plugin', pluginId: 'com.example.lua' });
    expect(entry.preset.permission?.granted()).toBe(false);
    granted = true;
    expect(entry.preset.permission?.granted()).toBe(true);

    if (result.ok) result.unregister();
    expect(registry.entries()).toEqual([]);
  });

  it('treats a built-in grant as permanent', () => {
    const registry = new LanguageServerRegistry([]);
    registerLanguageServerContributions(declared, {
      pluginId: 'com.zclaudia.lua',
      pluginPath: '/plugins/lua',
      registry,
      builtinShellExecute: true,
      hasPermission: () => false,
    });
    expect(registry.presets()[0].permission?.granted()).toBe(true);
  });

  it("re-evaluates the registry when this plugin's permissions change", async () => {
    const registry = new LanguageServerRegistry([]);
    const result = registerLanguageServerContributions(declared, {
      pluginId: 'com.example.lua',
      pluginPath: '/plugins/lua',
      registry,
      hasPermission: () => false,
    });
    let changes = 0;
    registry.onChange(() => changes++);
    await pluginEvents.emit('permission.revoked', {
      pluginId: 'com.other',
      permission: 'shell.execute',
    });
    expect(changes).toBe(0);
    await pluginEvents.emit('permission.granted', {
      pluginId: 'com.example.lua',
      permission: 'shell.execute',
    });
    expect(changes).toBe(1);
    if (result.ok) result.unregister();
    await pluginEvents.emit('permission.revoked', {
      pluginId: 'com.example.lua',
      permission: 'shell.execute',
    });
    expect(changes).toBe(2); // only the unregister itself
  });

  it('rejects invalid declarations without registering anything', () => {
    const registry = new LanguageServerRegistry([]);
    const result = registerLanguageServerContributions([{ id: 'Bad Id', command: '' }], {
      pluginId: 'com.example.bad',
      pluginPath: '/plugins/bad',
      registry,
    });
    expect(result.ok).toBe(false);
    expect(registry.entries()).toEqual([]);
  });
});
