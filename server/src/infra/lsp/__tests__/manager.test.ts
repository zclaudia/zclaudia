import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LanguageServerManager, type LanguageServerManagerOptions } from '../manager.js';
import type { DiagnosticsCheck, LanguageServerPreset } from '../types.js';
import { createFakeServer, type FakeServer, type FakeServerOptions } from './fake-lsp-server.js';

const fakePreset: LanguageServerPreset = {
  id: 'fake',
  name: 'Fake',
  languages: ['fake'],
  extensions: { '.fk': 'fake' },
  rootMarkers: [],
  resolveLaunch: root => ({ command: 'fake', args: [], cwd: root }),
};

function until(check: () => boolean, timeoutMs = 2000): Promise<void> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (check()) return resolve();
      if (Date.now() - started > timeoutMs) return reject(new Error('until: timed out'));
      setTimeout(tick, 5);
    };
    tick();
  });
}

function messages(check: DiagnosticsCheck): string[] {
  return check.state === 'ready' ? check.diagnostics.map(d => d.message) : [];
}

describe('LanguageServerManager', () => {
  let dir: string;
  let servers: FakeServer[];
  let serverOptions: FakeServerOptions;
  const managers: LanguageServerManager[] = [];

  function createManager(overrides: LanguageServerManagerOptions = {}) {
    const manager = new LanguageServerManager({
      presets: [fakePreset],
      settleMs: 10,
      spawn: async () => {
        const server = createFakeServer(serverOptions);
        servers.push(server);
        return server.transport;
      },
      ...overrides,
    });
    managers.push(manager);
    return manager;
  }

  async function started(manager: LanguageServerManager, root = dir) {
    await until(() => manager.status().some(s => s.root === root && s.state === 'ready'));
  }

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'lsp-manager-'));
    servers = [];
    serverOptions = {};
  });
  afterEach(async () => {
    await Promise.all(managers.splice(0).map(m => m.dispose()));
    rmSync(dir, { recursive: true, force: true });
  });

  it('lists only presets that resolve for the root', () => {
    const manager = createManager({
      presets: [fakePreset, { ...fakePreset, id: 'none', resolveLaunch: () => null }],
    });
    expect(manager.serversFor(dir).map(s => s.id)).toEqual(['fake']);
  });

  it('reports pending while starting instead of blocking, then real diagnostics', async () => {
    const manager = createManager();
    const file = path.join(dir, 'a.fk');
    writeFileSync(file, 'ok\nERR: broken\n');

    const first = await manager.diagnosticsFor(dir, file, { budgetMs: 500 });
    expect(first).toMatchObject({ state: 'pending', reason: 'starting' });

    await started(manager);
    const second = await manager.diagnosticsFor(dir, file, { budgetMs: 500 });
    expect(second.state).toBe('ready');
    expect(messages(second)).toEqual(['broken']);
  });

  it('diagnoses the old content first to give a baseline', async () => {
    const manager = createManager();
    manager.acquire(dir, 'test');
    await started(manager);
    const file = path.join(dir, 'a.fk');
    writeFileSync(file, 'ERR: old\nERR: new\n');

    const check = await manager.diagnosticsFor(dir, file, {
      budgetMs: 500,
      baselineContent: 'ERR: old\n',
    });
    expect(check.state).toBe('ready');
    if (check.state !== 'ready') return;
    expect(check.baseline?.map(d => d.message)).toEqual(['old']);
    expect(messages(check)).toEqual(['old', 'new']);

    // The settled result becomes the next change's baseline.
    writeFileSync(file, 'ERR: old\nERR: new\nERR: newer\n');
    const next = await manager.diagnosticsFor(dir, file, { budgetMs: 500 });
    expect(next.state === 'ready' && next.baseline?.map(d => d.message)).toEqual(['old', 'new']);
  });

  it('uses an empty baseline for a newly created file', async () => {
    const manager = createManager();
    manager.acquire(dir, 'test');
    await started(manager);
    const file = path.join(dir, 'new.fk');
    writeFileSync(file, 'ERR: x\n');
    const check = await manager.diagnosticsFor(dir, file, { budgetMs: 500, baselineContent: null });
    expect(check.state === 'ready' && check.baseline).toEqual([]);
  });

  it('times out as pending, never as an empty diagnostic list', async () => {
    serverOptions = { silent: true };
    const manager = createManager();
    manager.acquire(dir, 'test');
    await started(manager);
    const file = path.join(dir, 'a.fk');
    writeFileSync(file, 'ERR: x\n');
    expect(await manager.diagnosticsFor(dir, file, { budgetMs: 40 })).toMatchObject({
      state: 'pending',
      reason: 'timeout',
    });
  });

  it('is unavailable for unsupported files and files outside the root', async () => {
    const manager = createManager();
    expect(
      (await manager.diagnosticsFor(dir, path.join(dir, 'a.md'), { budgetMs: 10 })).state
    ).toBe('unavailable');
    expect(
      (await manager.diagnosticsFor(dir, path.join(dir, '..', 'x.fk'), { budgetMs: 10 })).state
    ).toBe('unavailable');
    expect(servers).toHaveLength(0);
  });

  it('keeps a leased server alive and stops it once idle', async () => {
    const manager = createManager({ idleTimeoutMs: 30 });
    const lease = manager.acquire(dir, 'run:1');
    await started(manager);
    expect(manager.status()[0].leases).toEqual(['run:1']);
    await new Promise(resolve => setTimeout(resolve, 60));
    expect(manager.status()[0].state).toBe('ready');

    lease.release();
    await until(() => manager.status()[0].state === 'idle');
    expect(servers[0].received.map(r => r.method)).toContain('shutdown');
  });

  it('backs off after a crash and gives up after repeated crashes', async () => {
    let clock = 1_000_000;
    const manager = createManager({ now: () => clock });
    const file = path.join(dir, 'a.fk');
    writeFileSync(file, 'x\n');

    for (let crash = 1; crash <= 3; crash++) {
      manager.acquire(dir, `run:${crash}`);
      await started(manager);
      servers.at(-1)!.crash();
      await until(() => manager.status()[0].state !== 'ready');
      if (crash < 3) {
        expect(manager.status()[0].state).toBe('stopped');
        // Inside the backoff window the server is not restarted.
        expect((await manager.diagnosticsFor(dir, file, { budgetMs: 10 })).state).toBe(
          'unavailable'
        );
        clock += 31_000; // past the longest backoff (30s)
      }
    }
    expect(manager.status()[0].state).toBe('failed');
    expect(manager.status()[0].lastError).toContain('exited unexpectedly');
  });

  it('evicts an unleased server to stay within the limit, refuses when all are leased', async () => {
    const otherRoot = mkdtempSync(path.join(tmpdir(), 'lsp-manager-other-'));
    const thirdRoot = mkdtempSync(path.join(tmpdir(), 'lsp-manager-third-'));
    try {
      const manager = createManager({ maxServers: 1 });
      const first = manager.acquire(dir, 'a');
      await started(manager);
      first.release();

      manager.acquire(otherRoot, 'b');
      await started(manager, otherRoot);
      await until(() => manager.status().find(s => s.root === dir)?.state === 'idle');

      const file = path.join(thirdRoot, 'c.fk');
      writeFileSync(file, 'x\n');
      const check = await manager.diagnosticsFor(thirdRoot, file, { budgetMs: 10 });
      expect(check).toMatchObject({ state: 'unavailable' });
      expect(check.state === 'unavailable' && check.reason).toContain('limit');
    } finally {
      rmSync(otherRoot, { recursive: true, force: true });
      rmSync(thirdRoot, { recursive: true, force: true });
    }
  });

  it('marks a server that dies before initialize failed at once and stops offering it', async () => {
    serverOptions = { dieOnInitialize: true };
    const manager = createManager();
    const file = path.join(dir, 'a.fk');
    writeFileSync(file, 'x\n');
    expect(manager.serversFor(dir).map(s => s.id)).toEqual(['fake']);
    manager.acquire(dir, 'run');
    await until(() => manager.status()[0]?.state === 'failed');
    expect(manager.status()[0].lastError).toContain(
      'exited during start-up (code 1): fake server stderr'
    );
    expect(manager.serversFor(dir)).toEqual([]);
    expect(servers).toHaveLength(1); // no retry loop
  });

  it('turning the switch off stops servers and offers nothing; on retries failed ones', async () => {
    const manager = createManager();
    const file = path.join(dir, 'a.fk');
    writeFileSync(file, 'x\n');
    manager.acquire(dir, 'run');
    await started(manager);

    await manager.setEnabled(false);
    expect(manager.status()[0].state).toBe('idle');
    expect(servers[0].received.map(r => r.method)).toContain('shutdown');
    expect(manager.serversFor(dir)).toEqual([]);
    expect(manager.statusFor(dir)).toEqual([]);
    expect(await manager.diagnosticsFor(dir, file, { budgetMs: 10 })).toMatchObject({
      state: 'unavailable',
      reason: 'Language servers are turned off in Settings',
    });
    await expect(
      manager.query({ cwd: dir, action: 'hover', file, line: 1, character: 1 })
    ).rejects.toMatchObject({ code: 'server_unavailable' });

    serverOptions = { dieOnInitialize: true };
    await manager.setEnabled(true);
    manager.acquire(dir, 'run');
    await until(() => manager.status()[0].state === 'failed');
    serverOptions = {};
    await manager.setEnabled(false);
    await manager.setEnabled(true);
    expect(manager.statusFor(dir)[0]).toMatchObject({ state: 'idle', lastError: null });
    expect(manager.serversFor(dir).map(s => s.id)).toEqual(['fake']);
  });

  it('stops every server on dispose', async () => {
    const manager = createManager();
    manager.acquire(dir, 'run');
    await started(manager);
    await manager.dispose();
    expect(manager.status().every(s => s.state === 'idle')).toBe(true);
    expect(servers[0].received.map(r => r.method)).toContain('shutdown');
  });
});
