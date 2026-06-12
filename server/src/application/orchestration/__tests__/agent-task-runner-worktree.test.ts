import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import type { ServerMessage } from '@zclaudia/shared/wire/messages';
import { applyMigrations } from '../../../infra/storage/migrations/index.js';
import { createAgentTaskRunner, type AgentRunnerTask } from '../agent-task-runner.js';

function git(cwd: string, cmd: string): string {
  return execSync(`git ${cmd}`, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function makeRepo(): string {
  const repo = mkdtempSync(path.join(tmpdir(), 'zc-runner-wt-'));
  git(repo, 'init -b main');
  git(repo, 'config user.email t@t.t');
  git(repo, 'config user.name t');
  writeFileSync(path.join(repo, 'README.md'), 'hi\n');
  git(repo, 'add .');
  git(repo, 'commit -m init');
  return repo;
}

function makeTask(overrides: Partial<AgentRunnerTask> = {}): AgentRunnerTask {
  return {
    id: `t-${Math.random().toString(36).slice(2, 8)}`,
    parentTaskId: null,
    projectId: null,
    sessionId: null,
    branchId: null,
    contextTemplate: 'agent',
    status: 'queued',
    task: 'do something',
    externalId: null,
    initiator: 'system',
    retryCount: 0,
    maxRetries: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe('agent task runner worktree isolation', () => {
  let db: Database.Database;
  let repo: string;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    applyMigrations(db);
    repo = makeRepo();
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
    db.close();
  });

  interface Harness {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    capturedRunStart: () => any;
    finishRun: (mutateWorkdir?: (dir: string) => void) => void;
    failRun: () => void;
    completed: () => { resultSummary: string; responseText: string } | undefined;
    failed: () => string | undefined;
    run: (task: AgentRunnerTask) => void;
  }

  function makeHarness(): Harness {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let runStartMessage: any;
    let agentWs: { send: (msg: ServerMessage) => void } | undefined;
    let completedResult: { resultSummary: string; responseText: string } | undefined;
    let failedError: string | undefined;
    const clients = new Map();

    const runner = createAgentTaskRunner({
      db,
      createVirtualClient: (id, ws) => {
        agentWs = ws;
        return { id };
      },
      handleRunStart: async (_client, message) => {
        runStartMessage = message;
      },
      getClients: () => clients,
      createSession: () => ({ id: 's-sub' }),
      sessionExists: () => true,
    });

    return {
      capturedRunStart: () => runStartMessage,
      finishRun: (mutateWorkdir) => {
        if (mutateWorkdir) mutateWorkdir(runStartMessage.workingDirectory);
        agentWs!.send({ type: 'run_completed', runId: 'r1', sessionId: 's-sub' } as ServerMessage);
      },
      failRun: () => {
        agentWs!.send({ type: 'run_failed', runId: 'r1', sessionId: 's-sub', error: 'boom' } as unknown as ServerMessage);
      },
      completed: () => completedResult,
      failed: () => failedError,
      run: (task) => runner.run(task, {
        onStarted: () => {},
        onCompleted: (result) => { completedResult = result; },
        onFailed: (error) => { failedError = error; },
      }),
    };
  }

  async function tick(): Promise<void> {
    await new Promise((r) => setTimeout(r, 50));
  }

  it('runs the subagent inside a fresh worktree and removes it when clean', async () => {
    const h = makeHarness();
    const task = makeTask({ cwd: repo, isolation: 'worktree' });
    h.run(task);
    await tick();

    const wd = h.capturedRunStart().workingDirectory as string;
    expect(wd).toBe(path.join(repo, '.worktrees', 'agents', `agent-${task.id}`));
    expect(existsSync(path.join(wd, 'README.md'))).toBe(true);

    h.finishRun();
    await tick();
    expect(h.completed()).toBeDefined();
    expect(existsSync(wd)).toBe(false);
  });

  it('keeps the worktree and reports it when the agent left changes', async () => {
    const h = makeHarness();
    const task = makeTask({ cwd: repo, isolation: 'worktree' });
    h.run(task);
    await tick();
    const wd = h.capturedRunStart().workingDirectory as string;

    h.finishRun((dir) => writeFileSync(path.join(dir, 'work.txt'), 'changes\n'));
    await tick();

    expect(existsSync(wd)).toBe(true);
    expect(h.completed()!.responseText).toContain(wd);
    expect(h.completed()!.responseText).toContain(`agent/${task.id}`);
  });

  it('runs in the parent cwd directly when isolation is not requested', async () => {
    const h = makeHarness();
    h.run(makeTask({ cwd: repo }));
    await tick();
    expect(h.capturedRunStart().workingDirectory).toBe(repo);
    h.finishRun();
    await tick();
    expect(existsSync(path.join(repo, '.worktrees'))).toBe(false);
  });

  it('falls back to the parent cwd when it is not a git repository', async () => {
    const plain = mkdtempSync(path.join(tmpdir(), 'zc-plain-'));
    const h = makeHarness();
    h.run(makeTask({ cwd: plain, isolation: 'worktree' }));
    await tick();
    expect(h.capturedRunStart().workingDirectory).toBe(plain);
    h.finishRun();
    await tick();
    expect(h.completed()).toBeDefined();
    rmSync(plain, { recursive: true, force: true });
  });

  it('cleans up the worktree on failure too', async () => {
    const h = makeHarness();
    const task = makeTask({ cwd: repo, isolation: 'worktree' });
    h.run(task);
    await tick();
    const wd = h.capturedRunStart().workingDirectory as string;

    h.failRun();
    await tick();
    expect(h.failed()).toBe('boom');
    expect(existsSync(wd)).toBe(false);
  });
});
