import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BUILTIN_AGENT_PLUGINS } from '@zclaudia/shared/plugins/builtin-agents';
import { PluginLoader } from '../loader.js';
import { resolveBuiltinAgentRoot } from '../builtin-agents.js';
import { PluginManagementService } from '../management-service.js';
import { applyMigrations } from '../../../infra/storage/migrations/index.js';
import { AgentProfileRepository } from '../../../domains/agent-profiles/repository.js';
import { providerRegistry } from '../../../infra/providers/registry.js';
import { runtimeDescriptorRegistry } from '../../../infra/providers/runtime-descriptor-registry.js';

describe('host-owned built-in agent lifecycle', () => {
  let directory: string;
  let db: Database.Database;
  let loader: PluginLoader;

  function writePlugin(runtime: string, root = path.join(directory, 'builtin')) {
    const pluginDir = path.join(root, runtime);
    mkdirSync(pluginDir, { recursive: true });
    const manifest = JSON.parse(
      readFileSync(path.join(resolveBuiltinAgentRoot(), runtime, 'plugin.json'), 'utf8')
    );
    manifest.main = 'main.mjs';
    writeFileSync(path.join(pluginDir, 'plugin.json'), JSON.stringify(manifest));
    writeFileSync(
      path.join(pluginDir, 'main.mjs'),
      `
      export function activate(context) {
        if (!context.agentRuntimes) throw new Error('Missing registration permission');
        context.agentRuntimes.register({ type: ${JSON.stringify(runtime)}, async *run() {} });
      }
    `
    );
    return pluginDir;
  }

  beforeEach(() => {
    directory = mkdtempSync(path.join(os.tmpdir(), 'builtin-agent-test-'));
    vi.stubEnv('ZCLAUDIA_DATA_DIR', path.join(directory, 'data'));
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    applyMigrations(db);
    for (const plugin of BUILTIN_AGENT_PLUGINS) writePlugin(plugin.runtime);
    loader = new PluginLoader({ builtinAgentRoot: path.join(directory, 'builtin') });
    loader.setDatabase(db);
  });

  afterEach(async () => {
    loader.setRuntimeBusyChecker(() => false);
    await loader.deactivateAll();
    for (const plugin of BUILTIN_AGENT_PLUGINS) {
      providerRegistry.removePluginAdapters(plugin.id);
      runtimeDescriptorRegistry.removeForPlugin(plugin.id);
    }
    db.close();
    rmSync(directory, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it('rejects malformed directory and package.json runtime declarations without interrupting discovery', async () => {
    for (const [name, filename, agentRuntimes] of [
      ['directory', 'plugin.json', { type: 'codex' }],
      ['npm', 'package.json', [null]],
    ] as const) {
      const pluginDir = path.join(directory, 'data/plugins', name);
      mkdirSync(pluginDir, { recursive: true });
      const manifest = {
        id: `external.${name}`,
        name,
        description: 'Malformed runtime fixture',
        version: '1.0.0',
        contributes: { agentRuntimes },
      };
      writeFileSync(
        path.join(pluginDir, filename),
        JSON.stringify(
          filename === 'package.json'
            ? { ...manifest, contributes: {}, claudia: manifest }
            : manifest
        )
      );
    }
    await expect(loader.discover()).resolves.toHaveLength(3);
    await loader.activateBuiltins();
    expect(loader.getPlugin('external.directory')).toBeUndefined();
    expect(loader.getPlugin('external.npm')).toBeUndefined();
    for (const plugin of BUILTIN_AGENT_PLUGINS)
      expect(loader.getPlugin(plugin.id)?.isActive).toBe(true);
  });

  it('isolates a malformed built-in runtime descriptor and recovers after repair', async () => {
    const filename = path.join(directory, 'builtin/codex/plugin.json');
    const manifest = JSON.parse(readFileSync(filename, 'utf8'));
    manifest.contributes.agentRuntimes = [null];
    writeFileSync(filename, JSON.stringify(manifest));
    await expect(loader.discover()).resolves.toHaveLength(3);
    await loader.activateBuiltins();
    expect(loader.getPlugin('com.zclaudia.codex')?.error).toBeTruthy();
    expect(providerRegistry.hasType('codex')).toBe(false);
    expect(providerRegistry.hasType('claude')).toBe(true);
    expect(providerRegistry.hasType('cursor')).toBe(true);
    writePlugin('codex');
    expect(await loader.reload('com.zclaudia.codex')).toBe(true);
    expect(providerRegistry.hasType('codex')).toBe(true);
  });

  it('registers all three without a permission grant or LLM profile', async () => {
    await loader.discover();
    await loader.activateBuiltins();
    for (const plugin of BUILTIN_AGENT_PLUGINS) {
      expect(loader.getPlugin(plugin.id)?.isActive).toBe(true);
      expect(loader.getPlugin(plugin.id)?.pendingPermissions).toBeUndefined();
      expect(providerRegistry.hasType(plugin.runtime)).toBe(true);
      const profile = new AgentProfileRepository(db).findByPluginProfile(
        plugin.id,
        `${plugin.runtime}-default`
      );
      expect(profile).toMatchObject({ runtimeType: plugin.runtime, llmProfileId: null, model: '' });
    }
  });

  it('retains user settings, identity and disabled preference through shutdown and restart', async () => {
    await loader.discover();
    await loader.activateBuiltins();
    const repo = new AgentProfileRepository(db);
    const original = repo.findByPluginProfile('com.zclaudia.codex', 'codex-default')!;
    repo.update(original.id, {
      name: 'My Codex',
      systemPrompt: 'Keep this',
      cliPath: '/custom/codex',
    });
    const service = new PluginManagementService({ loader });
    await service.deactivatePlugin('com.zclaudia.codex');
    expect(repo.findById(original.id)?.runtimeType).toBe('codex');
    await loader.deactivateAll();
    loader = new PluginLoader({ builtinAgentRoot: path.join(directory, 'builtin') });
    loader.setDatabase(db);
    await loader.discover();
    await loader.activateBuiltins();
    expect(loader.getPlugin('com.zclaudia.codex')?.isActive).toBe(false);
    await new PluginManagementService({ loader }).activatePlugin('com.zclaudia.codex');
    expect(repo.findByPluginProfile('com.zclaudia.codex', 'codex-default')).toMatchObject({
      id: original.id,
      name: 'My Codex',
      systemPrompt: 'Keep this',
      cliPath: '/custom/codex',
    });
    expect(repo.findAllOrdered()).toHaveLength(3);
  });

  it('shadows same-ID external packages without touching their files', async () => {
    const external = writePlugin('codex', path.join(directory, 'data/plugins'));
    const main = path.join(external, 'main.mjs');
    writeFileSync(main, "throw new Error('External plugin must never execute');");
    await loader.discover();
    await loader.activateBuiltins();
    expect(loader.getPlugin('com.zclaudia.codex')?.isActive).toBe(true);
    expect(loader.getShadowedPaths('com.zclaudia.codex')).toEqual([external]);
    expect(readFileSync(main, 'utf8')).toContain('External plugin must never execute');
  });

  it('reserves identities even when the built-in installation is incomplete', async () => {
    rmSync(path.join(directory, 'builtin/codex'), { recursive: true });
    writePlugin('codex', path.join(directory, 'data/plugins'));
    await loader.discover();
    await loader.activateBuiltins();
    expect(loader.getPlugin('com.zclaudia.codex')).toMatchObject({ isActive: false });
    expect(loader.getPlugin('com.zclaudia.codex')?.error).toContain('resources are missing');
    expect(providerRegistry.hasType('codex')).toBe(false);
    expect(providerRegistry.hasType('claude')).toBe(true);
    writePlugin('codex');
    expect(await loader.reload('com.zclaudia.codex')).toBe(true);
    expect(providerRegistry.hasType('codex')).toBe(true);
  });

  it('commits profiles and migration journal atomically and retries after failure', async () => {
    db.exec(`CREATE TRIGGER fail_builtin_journal BEFORE INSERT ON app_config
      WHEN NEW.key = 'builtin_plugin_migration:com.zclaudia.codex'
      BEGIN SELECT RAISE(ABORT, 'Injected journal failure'); END;`);
    await loader.discover();
    expect(await loader.activate('com.zclaudia.codex')).toBe(false);
    expect(
      new AgentProfileRepository(db).findByPluginProfile('com.zclaudia.codex', 'codex-default')
    ).toBeUndefined();
    expect(providerRegistry.hasType('codex')).toBe(false);
    expect(
      db
        .prepare('SELECT value FROM app_config WHERE key = ?')
        .get('builtin_plugin_migration:com.zclaudia.codex')
    ).toBeUndefined();
    db.exec('DROP TRIGGER fail_builtin_journal');
    expect(await loader.activate('com.zclaudia.codex')).toBe(true);
    expect(new AgentProfileRepository(db).findAllOrdered()).toHaveLength(1);
  });

  it('rolls back failed registration without deleting an existing profile', async () => {
    await loader.discover();
    await loader.activateBuiltins();
    const repo = new AgentProfileRepository(db);
    const original = repo.findByPluginProfile('com.zclaudia.codex', 'codex-default')!;
    await loader.deactivate('com.zclaudia.codex');
    writeFileSync(
      path.join(directory, 'builtin/codex/broken.mjs'),
      "export function activate() { throw new Error('Broken runtime'); }"
    );
    const manifestPath = path.join(directory, 'builtin/codex/plugin.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.main = 'broken.mjs';
    writeFileSync(manifestPath, JSON.stringify(manifest));
    await loader.reload('com.zclaudia.codex');
    expect(await loader.activate('com.zclaudia.codex')).toBe(false);
    expect(repo.findById(original.id)?.runtimeType).toBe('codex');
    expect(providerRegistry.hasType('codex')).toBe(false);
    expect(runtimeDescriptorRegistry.hasType('codex')).toBe(false);
    writePlugin('codex');
    expect(await loader.reload('com.zclaudia.codex')).toBe(true);
    expect(await loader.activate('com.zclaudia.codex')).toBe(true);
    expect(repo.findAllOrdered()).toHaveLength(3);
  });

  it('rejects runtime mutation while busy and never removes a built-in', async () => {
    await loader.discover();
    await loader.activateBuiltins();
    loader.setRuntimeBusyChecker(runtime => runtime === 'codex');
    const service = new PluginManagementService({ loader });
    await expect(service.deactivatePlugin('com.zclaudia.codex')).rejects.toMatchObject({
      status: 409,
      code: 'RUNTIME_BUSY',
    });
    await expect(service.reloadPlugin('com.zclaudia.codex')).rejects.toMatchObject({
      status: 409,
      code: 'RUNTIME_BUSY',
    });
    await expect(service.removePlugin('com.zclaudia.codex')).rejects.toMatchObject({
      status: 409,
      code: 'BUILTIN_PLUGIN',
    });
    expect(loader.getPlugin('com.zclaudia.codex')?.isActive).toBe(true);
  });

  it('deduplicates concurrent activation and repeated discovery', async () => {
    await loader.discover();
    await Promise.all([loader.activateBuiltins(), loader.activateBuiltins()]);
    expect(await loader.discover()).toEqual([]);
    expect(new AgentProfileRepository(db).findAllOrdered()).toHaveLength(3);
  });

  it('withdraws a stopping adapter and serializes reactivation behind teardown', async () => {
    await loader.discover();
    await loader.activateBuiltins();
    let release: (() => void) | undefined;
    let entered: (() => void) | undefined;
    const started = new Promise<void>(resolve => {
      entered = resolve;
    });
    const instance = loader.getPlugin('com.zclaudia.codex')!;
    instance.module = {
      deactivate: () =>
        new Promise<void>(resolve => {
          release = resolve;
          entered?.();
        }),
    };
    const stopping = loader.deactivate('com.zclaudia.codex');
    await started;
    expect(providerRegistry.hasType('codex')).toBe(false);
    const restarting = loader.activate('com.zclaudia.codex');
    release?.();
    expect(await stopping).toBe(true);
    expect(await restarting).toBe(true);
    expect(providerRegistry.hasType('codex')).toBe(true);
    expect(new AgentProfileRepository(db).findAllOrdered()).toHaveLength(3);
  });
});
