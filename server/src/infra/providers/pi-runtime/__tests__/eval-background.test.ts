import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

import { applyMigrations } from '../../../../infra/storage/migrations/index.js';
import { TaskRepository } from '../../../../domains/tasks/repository.js';
import { TaskService } from '../../../../domains/tasks/task-service.js';
import { createEvalBridgeTool } from '../eval-tool.js';
import { EvalTaskRuntime } from '../eval-task-runtime.js';
import { createTaskOutputTool } from '../task-tools.js';

async function eventually<T>(fn: () => T, predicate: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 5_000;
  let value = fn();
  while (!predicate(value) && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 100));
    value = fn();
  }
  return value;
}

describe('Eval background runtime', () => {
  let db: Database.Database | undefined;
  let dir: string | undefined;
  let dataDir: string | undefined;
  let prevDataDir: string | undefined;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    applyMigrations(db);
    dir = mkdtempSync(path.join(tmpdir(), 'zc-eval-bg-work-'));
    dataDir = mkdtempSync(path.join(tmpdir(), 'zc-eval-bg-data-'));
    prevDataDir = process.env.ZCLAUDIA_DATA_DIR;
    process.env.ZCLAUDIA_DATA_DIR = dataDir;
  });

  afterEach(() => {
    db?.close();
    if (dir) rmSync(dir, { recursive: true, force: true });
    if (dataDir) rmSync(dataDir, { recursive: true, force: true });
    if (prevDataDir === undefined) delete process.env.ZCLAUDIA_DATA_DIR;
    else process.env.ZCLAUDIA_DATA_DIR = prevDataDir;
  });

  it('runs isolated one-shot code as a task readable through TaskOutput', async () => {
    expect(db).toBeDefined();
    expect(dir).toBeDefined();
    const evalTool = createEvalBridgeTool(dir!, { sessionId: 's1', runId: 'r1', db: db! }) as any;
    const start = await evalTool.execute('eval-bg-1', {
      code: "console.log('hello from eval'); 21 * 2",
      run_in_background: true,
    });

    expect(start.details).toMatchObject({
      ok: true,
      type: 'eval',
    });

    const taskId = start.details.taskId as string;
    const repo = new TaskRepository(db!);
    expect(repo.findById(taskId)).toMatchObject({
      sessionId: 's1',
      runId: 'r1',
    });
    const completed = await eventually(
      () => repo.findById(taskId),
      task => task?.status === 'completed' || task?.status === 'failed'
    );

    expect(completed).toMatchObject({
      type: 'eval',
      status: 'completed',
    });

    const outputTool = createTaskOutputTool(db!) as any;
    const output = await outputTool.execute('eval-bg-output-1', { task_id: taskId });
    expect(output.details).toMatchObject({
      ok: true,
      taskId,
      status: 'completed',
    });
    expect(output.details.rawOutput).toContain('hello from eval');
    expect(output.details.rawOutput).toContain('42');
    // The task process runs with cwd = workspaceRoot; the output must show the
    // real root, not a self-relativized 'Cwd: .'.
    expect(output.content[0].text).toContain(`Cwd: ${dir}`);
    expect(output.content[0].text).not.toContain('Cwd: .');
  });

  it('carries session-granted sandbox domains into the background task privilege plan', async () => {
    expect(db).toBeDefined();
    expect(dir).toBeDefined();
    const evalTool = createEvalBridgeTool(dir!, {
      sessionId: 's1',
      runId: 'r1',
      db: db!,
      sandboxAllowedDomains: ['granted.example.com', 'other.example.com'],
    }) as any;

    const start = await evalTool.execute('eval-bg-grants', {
      code: '1 + 1',
      run_in_background: true,
    });

    expect(start.details).toMatchObject({ ok: true, type: 'eval' });
    const repo = new TaskRepository(db!);
    const task = repo.findById(start.details.taskId as string);
    expect(task?.metadata?.privilegePlan).toEqual({
      mode: 'sandbox',
      grants: [
        { type: 'network', host: 'granted.example.com' },
        { type: 'network', host: 'other.example.com' },
      ],
    });
  });

  it('removes per-task payload and result files once the task settles', async () => {
    expect(db).toBeDefined();
    expect(dir).toBeDefined();
    expect(dataDir).toBeDefined();
    const evalTool = createEvalBridgeTool(dir!, { sessionId: 's1', runId: 'r1', db: db! }) as any;
    const start = await evalTool.execute('eval-bg-cleanup', {
      code: "'cleanup probe'",
      run_in_background: true,
    });
    const taskId = start.details.taskId as string;
    const payloadPath = path.join(dataDir!, 'task-scripts', `${taskId}.eval.json`);
    const resultPath = path.join(dataDir!, 'task-logs', `${taskId}.result.json`);

    const repo = new TaskRepository(db!);
    const completed = await eventually(
      () => repo.findById(taskId),
      task => task?.status === 'completed' || task?.status === 'failed'
    );

    expect(completed?.status).toBe('completed');
    expect(existsSync(payloadPath)).toBe(false);
    expect(existsSync(resultPath)).toBe(false);
    // The user-visible log survives settlement; only payload/result are per-run scratch.
    expect(existsSync(path.join(dataDir!, 'task-logs', `${taskId}.log`))).toBe(true);
  });

  it('reconciles completed and failed tasks from result files after restart', () => {
    expect(db).toBeDefined();
    expect(dir).toBeDefined();
    expect(dataDir).toBeDefined();
    const repo = new TaskRepository(db!);
    const service = new TaskService(repo);
    const logsDir = path.join(dataDir!, 'task-logs');
    mkdirSync(logsDir, { recursive: true });

    const successLogPath = path.join(logsDir, 'eval-success.log');
    const successResultPath = path.join(logsDir, 'eval-success.result.json');
    writeFileSync(successLogPath, '42\n');
    writeFileSync(successResultPath, JSON.stringify({ ok: true, text: '42' }));
    const success = service.createTask({
      type: 'eval',
      sessionId: 's1',
      runId: 'r1',
      metadata: {
        code: '42',
        workspaceRoot: dir!,
        logPath: successLogPath,
        resultPath: successResultPath,
      },
    });
    service.startTask(success.id, { executorRef: { pid: 999999, command: 'eval' } });

    const failureLogPath = path.join(logsDir, 'eval-failure.log');
    const failureResultPath = path.join(logsDir, 'eval-failure.result.json');
    writeFileSync(failureLogPath, 'boom\n');
    writeFileSync(failureResultPath, JSON.stringify({ ok: false, error: 'boom' }));
    const failure = service.createTask({
      type: 'eval',
      sessionId: 's1',
      runId: 'r1',
      metadata: {
        code: 'throw new Error("boom")',
        workspaceRoot: dir!,
        logPath: failureLogPath,
        resultPath: failureResultPath,
      },
    });
    service.startTask(failure.id, { executorRef: { pid: 999999, command: 'eval' } });

    new EvalTaskRuntime(repo).reconcile();

    expect(repo.findById(success.id)).toMatchObject({
      status: 'completed',
      result: { text: '42' },
    });
    expect(repo.findById(failure.id)).toMatchObject({
      status: 'failed',
      result: { error: 'boom' },
    });
  });
});
