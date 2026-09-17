import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { applyMigrations } from '../../../infra/storage/migrations/index.js';
import { SessionModelSettingsService } from '../model-settings-service.js';
import { resolveAgentForSession } from '../agent-resolver.js';
import { SessionRuntimeBindingRepository } from '../runtime-binding-repository.js';
import type { ProviderRegistryPort } from '../../../infra/providers/registry.js';

vi.mock('../../../application/managed-runtimes/service.js', () => ({
  managedRuntimeService: { resolveForRuntime: vi.fn(async () => undefined) },
}));
let db: Database.Database;
let busy: boolean;
let discoverModels: ReturnType<typeof vi.fn>;
let service: SessionModelSettingsService;
const choice = { model: 'm2', thinkingLevel: 'high', revision: 0 };
beforeEach(() => {
  db = new Database(':memory:');
  applyMigrations(db);
  busy = false;
  db.prepare(
    "INSERT INTO projects (id,name,root_path,created_at,updated_at) VALUES ('p','P','/tmp',0,0)"
  ).run();
  db.prepare(
    "INSERT INTO agent_profiles (id,name,runtime_type,model,thinking_level,system_prompt,enabled_tools,created_at,updated_at) VALUES ('a','A','codex','m1','low','','[]',0,0)"
  ).run();
  db.prepare(
    "INSERT INTO sessions (id,project_id,agent_profile_id,type,created_at,updated_at) VALUES ('s','p','a','regular',0,0)"
  ).run();
  discoverModels = vi.fn(async () => ({
    currentModel: 'm1',
    models: [
      { id: 'm1', label: 'One', thinkingLevels: ['low'] },
      { id: 'm2', label: 'Two', thinkingLevels: ['low', 'high'] },
    ],
  }));
  const registry = { get: () => ({ discoverModels }) } as unknown as ProviderRegistryPort;
  service = new SessionModelSettingsService(db, registry, () => busy);
});
afterEach(() => db.close());

describe('session model selection', () => {
  it('caches discovery until an explicit refresh', async () => {
    await service.read('s', true);
    await service.read('s', true);
    expect(discoverModels).toHaveBeenCalledTimes(1);
    await service.read('s', true, true);
    expect(discoverModels).toHaveBeenCalledTimes(2);
  });
  it('persists across resolver calls without changing the agent or bound connection', async () => {
    const repo = new SessionRuntimeBindingRepository(db);
    repo.upsert({
      sessionId: 's',
      runtimeType: 'codex',
      engineMode: 'cli',
      model: 'm1',
      llmProfileId: null,
      connectionIdentityHash: null,
      configuredCliPath: '/custom/codex',
      configNamespace: null,
      runtimeDetails: null,
    });
    await service.save('s', choice);
    const resolved = resolveAgentForSession(db, { explicitAgentId: 'a', sessionId: 's' }).agent;
    expect(resolved).toMatchObject({
      model: 'm2',
      thinkingLevel: 'high',
      cliPath: '/custom/codex',
    });
    expect(db.prepare("SELECT model FROM agent_profiles WHERE id='a'").get()).toEqual({
      model: 'm1',
    });
    expect(repo.findBySessionId('s')?.model).toBe('m1');
    await service.save('s', { model: null, thinkingLevel: null, revision: 1 });
    expect(
      resolveAgentForSession(db, { explicitAgentId: 'a', sessionId: 's' }).agent
    ).toMatchObject({ model: 'm1', thinkingLevel: 'low' });
  });
  it('does not carry profile effort onto a different model', async () => {
    await service.save('s', { ...choice, thinkingLevel: null });
    expect(
      resolveAgentForSession(db, { explicitAgentId: 'a', sessionId: 's' }).agent.thinkingLevel
    ).toBeUndefined();
  });
  it('rejects unsupported effort and malformed input', async () => {
    await expect(service.save('s', { ...choice, model: 'm1' })).rejects.toMatchObject({
      code: 'THINKING_UNSUPPORTED',
    });
    await expect(service.save('s', { ...choice, model: 'm2\n--bad' })).rejects.toMatchObject({
      code: 'INVALID_MODEL',
    });
    await expect(service.save('s', { ...choice, endpoint: 'other' })).rejects.toMatchObject({
      code: 'INVALID_MODEL_SETTINGS',
    });
  });
  it('rejects changes while running, including a run started during discovery', async () => {
    busy = true;
    await expect(service.save('s', choice)).rejects.toMatchObject({ code: 'SESSION_BUSY' });
    busy = false;
    discoverModels.mockImplementation(async () => {
      busy = true;
      return { models: [{ id: 'm2', label: 'Two', thinkingLevels: ['high'] }] };
    });
    await expect(service.save('s', choice)).rejects.toMatchObject({ code: 'SESSION_BUSY' });
  });
  it('detects conflicting edits and rejects read-only sessions', async () => {
    await service.save('s', choice);
    await expect(service.save('s', choice)).rejects.toMatchObject({
      code: 'MODEL_SETTINGS_CHANGED',
    });
    db.prepare("UPDATE sessions SET is_read_only=1 WHERE id='s'").run();
    await expect(service.save('s', { ...choice, revision: 1 })).rejects.toMatchObject({
      code: 'SESSION_READONLY',
    });
  });
  it('uses ACP for new Cursor sessions but preserves legacy permissions', async () => {
    db.prepare("UPDATE agent_profiles SET runtime_type='cursor' WHERE id='a'").run();
    expect(await service.read('s')).toMatchObject({
      supportsPermissionOverrides: true,
      allowManualModel: false,
    });
    db.prepare("UPDATE sessions SET sdk_session_id='legacy' WHERE id='s'").run();
    expect(await service.read('s')).toMatchObject({
      supportsPermissionOverrides: false,
      allowManualModel: true,
    });
    const legacy = await service.read('s', true);
    expect(legacy.models.map(m => m.id)).toEqual(['m1', 'm2']);
    expect(discoverModels).toHaveBeenLastCalledWith(
      expect.objectContaining({ providerTransport: 'cursor-stream-json-v1' }),
      expect.any(AbortSignal)
    );
    expect(
      db.prepare("SELECT sdk_session_id, provider_transport FROM sessions WHERE id='s'").get()
    ).toEqual({
      sdk_session_id: 'legacy',
      provider_transport: null,
    });
  });
  it('reports legacy discovery failures instead of silently returning no models', async () => {
    db.prepare("UPDATE agent_profiles SET runtime_type='cursor' WHERE id='a'").run();
    db.prepare("UPDATE sessions SET provider_transport='cursor-stream-json-v1' WHERE id='s'").run();
    discoverModels.mockRejectedValue(new Error('CLI unavailable'));
    expect(await service.read('s', true)).toMatchObject({
      models: [],
      discoveryError: expect.any(String),
    });
  });
  it('only accepts complete model variant IDs offered by Cursor', async () => {
    db.prepare("UPDATE agent_profiles SET runtime_type='cursor' WHERE id='a'").run();
    discoverModels.mockResolvedValue({
      models: [{ id: 'm2[thinking=true]', label: 'Two', thinkingLevels: [] }],
    });
    await expect(service.save('s', { ...choice, thinkingLevel: null })).rejects.toMatchObject({
      code: 'MODEL_UNAVAILABLE',
    });
    const saved = await service.save('s', {
      ...choice,
      model: 'm2[thinking=true]',
      thinkingLevel: null,
    });
    expect(saved.selection.model).toBe('m2[thinking=true]');
  });
  it('uses the SDK connection catalog rather than the external CLI account', async () => {
    db.prepare(
      "INSERT INTO llm_profiles (id,name,provider_type,api_key,models,created_at,updated_at) VALUES ('llm','L','openai','test',?,0,0)"
    ).run(JSON.stringify([{ modelId: 'custom', thinkingLevels: ['high'] }]));
    db.prepare(
      "UPDATE agent_profiles SET engine_mode='sdk',llm_profile_id='llm' WHERE id='a'"
    ).run();
    const saved = await service.save('s', { ...choice, model: 'custom' });
    expect(saved.selection.model).toBe('custom');
    expect(discoverModels).not.toHaveBeenCalled();
  });
});
