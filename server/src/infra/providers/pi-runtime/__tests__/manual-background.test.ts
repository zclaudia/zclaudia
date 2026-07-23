import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { runBash, killProcessTree } from '../bash-runner.js';
import { buildTools } from '../tool-bridge.js';
import {
  registerInflightForegroundCommand,
  requestBackgroundForCommand,
  listInflightForegroundCommands,
  __resetInflightForegroundCommandsForTests,
} from '../inflight-bash-registry.js';
import { applyMigrations } from '../../../../infra/storage/migrations/index.js';
import { TaskRepository } from '../../../../domains/tasks/repository.js';
import {
  commandTaskLogPath,
  pidAlive,
} from '../../../../domains/tasks/executors/command-executor.js';

async function waitUntil(predicate: () => boolean, timeoutMs = 5000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise(r => setTimeout(r, 50));
  }
  return predicate();
}

describe('inflight foreground command registry', () => {
  beforeEach(() => __resetInflightForegroundCommandsForTests());

  it('registers, lists, and unregisters commands', () => {
    const unregister = registerInflightForegroundCommand({
      sessionId: 's1',
      toolUseId: 't1',
      command: 'sleep 5',
      startedAt: Date.now(),
      requestBackground: () => {},
    });
    expect(listInflightForegroundCommands('s1')).toHaveLength(1);
    unregister();
    expect(listInflightForegroundCommands('s1')).toHaveLength(0);
  });

  it('request targets the oldest command when no toolUseId given', () => {
    const fired: string[] = [];
    registerInflightForegroundCommand({
      sessionId: 's1',
      toolUseId: 't-new',
      command: 'b',
      startedAt: Date.now() - 1000,
      requestBackground: () => fired.push('t-new'),
    });
    registerInflightForegroundCommand({
      sessionId: 's1',
      toolUseId: 't-old',
      command: 'a',
      startedAt: Date.now() - 2000,
      requestBackground: () => fired.push('t-old'),
    });
    const result = requestBackgroundForCommand('s1');
    expect(result.ok).toBe(true);
    expect(fired).toEqual(['t-old']);
  });

  it('request by toolUseId targets the matching command', () => {
    const fired: string[] = [];
    registerInflightForegroundCommand({
      sessionId: 's1',
      toolUseId: 't1',
      command: 'a',
      startedAt: Date.now(),
      requestBackground: () => fired.push('t1'),
    });
    const miss = requestBackgroundForCommand('s1', 'nope');
    expect(miss.ok).toBe(false);
    const hit = requestBackgroundForCommand('s1', 't1');
    expect(hit.ok).toBe(true);
    expect(fired).toEqual(['t1']);
  });

  it('request fails cleanly when nothing is in flight', () => {
    const result = requestBackgroundForCommand('empty-session');
    expect(result.ok).toBe(false);
  });
});

describe('runBash backgroundSignal handoff', () => {
  it('hands off immediately when the signal fires', async () => {
    const controller = new AbortController();
    const start = Date.now();
    const promise = runBash({
      command: 'echo working; sleep 5; echo late',
      cwd: tmpdir(),
      timeoutSec: 30,
      backgroundSignal: controller.signal,
    });
    setTimeout(() => controller.abort(), 300);
    const res = await promise;
    const elapsed = Date.now() - start;
    try {
      expect(res.handoff).toBeDefined();
      expect(elapsed).toBeLessThan(3000);
      expect(res.fullOutput).toContain('working');
      expect(pidAlive(res.handoff!.child.pid!)).toBe(true);
    } finally {
      if (res.handoff?.child.pid) killProcessTree(res.handoff.child.pid);
    }
  });

  it('signal after completion has no effect', async () => {
    const controller = new AbortController();
    const res = await runBash({
      command: 'echo done',
      cwd: tmpdir(),
      timeoutSec: 30,
      backgroundSignal: controller.signal,
    });
    controller.abort();
    expect(res.handoff).toBeUndefined();
    expect(res.exitCode).toBe(0);
  });
});

describe('manual backgrounding (tool integration)', () => {
  let db: Database.Database;
  let dataDir: string;
  let prevDataDir: string | undefined;

  beforeEach(() => {
    __resetInflightForegroundCommandsForTests();
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    applyMigrations(db);
    dataDir = mkdtempSync(path.join(tmpdir(), 'zc-manualbg-'));
    prevDataDir = process.env.ZCLAUDIA_DATA_DIR;
    process.env.ZCLAUDIA_DATA_DIR = dataDir;
  });

  afterEach(() => {
    if (prevDataDir === undefined) delete process.env.ZCLAUDIA_DATA_DIR;
    else process.env.ZCLAUDIA_DATA_DIR = prevDataDir;
    rmSync(dataDir, { recursive: true, force: true });
    db.close();
  });

  it('converts a waiting foreground command via the registry', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-manualbg-ws-'));
    const bash = buildTools(dir, { enabled: ['Bash'], db, sessionId: 's1' }).find(
      (t: any) => t.name === 'Bash'
    ) as any;

    const pending = bash.execute('mb1', { command: 'echo early; sleep 2; echo late' });
    const registered = await waitUntil(() => listInflightForegroundCommands('s1').length === 1);
    expect(registered).toBe(true);
    // let the command produce its first output before converting
    await new Promise(r => setTimeout(r, 400));

    const request = requestBackgroundForCommand('s1');
    expect(request.ok).toBe(true);

    const res = await pending;
    expect(res.details.background).toBe(true);
    expect(res.details.taskId).toBeDefined();
    expect(res.content[0].text).toContain('early');

    const repo = new TaskRepository(db);
    const completed = await waitUntil(
      () => repo.findById(res.details.taskId)?.status === 'completed'
    );
    expect(completed).toBe(true);
    expect(readFileSync(commandTaskLogPath(res.details.taskId), 'utf8')).toContain('late');
    // registry cleaned up after the tool returned
    expect(listInflightForegroundCommands('s1')).toHaveLength(0);
    rmSync(dir, { recursive: true, force: true });
  });

  it('manual conversion works even with an explicit timeout', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-manualbg-ws-'));
    const bash = buildTools(dir, { enabled: ['Bash'], db, sessionId: 's1' }).find(
      (t: any) => t.name === 'Bash'
    ) as any;

    const pending = bash.execute('mb2', { command: 'sleep 1; echo fin', timeout: 30 });
    await waitUntil(() => listInflightForegroundCommands('s1').length === 1);
    expect(requestBackgroundForCommand('s1').ok).toBe(true);
    const res = await pending;
    expect(res.details.background).toBe(true);
    // let the adopted child settle before the data dir is removed
    const repo = new TaskRepository(db);
    await waitUntil(() => repo.findById(res.details.taskId)?.status === 'completed');
    rmSync(dir, { recursive: true, force: true });
  });

  it('a normally-completing command leaves no registry residue', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-manualbg-ws-'));
    const bash = buildTools(dir, { enabled: ['Bash'], db, sessionId: 's1' }).find(
      (t: any) => t.name === 'Bash'
    ) as any;
    const res = await bash.execute('mb3', { command: 'echo quick' });
    expect(res.details.ok).toBe(true);
    expect(res.details.background).toBeUndefined();
    expect(listInflightForegroundCommands('s1')).toHaveLength(0);
    rmSync(dir, { recursive: true, force: true });
  });
});
