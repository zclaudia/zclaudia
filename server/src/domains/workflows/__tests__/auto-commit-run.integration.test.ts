import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { applyMigrations } from '../../../infra/storage/migrations/index.js';
import { WorkflowEngine } from '../engine.js';
import { CompositeStepExecutor } from '../step-executors/composite-executor.js';
import { ConditionStepExecutor, ActivityStepExecutorAdapter } from '../step-executors/index.js';
import { ActivityRegistry } from '../../activities/index.js';
import { GitStageActivity } from '../../activities/git/git-stage.js';
import { GitCommitActivity } from '../../activities/git/git-commit.js';
import { WorkflowRunRepository } from '../workflow-run-repository.js';
import { BUILTIN_WORKFLOW_TEMPLATES, AI_AUTO_COMMIT_TEMPLATE_ID } from '../templates.js';
import type { WorkflowRun } from '@zclaudia/shared/features/workflows';

function initRepo(dir: string) {
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 't@t.co'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'T'], { cwd: dir });
}

describe('AI auto-commit end-to-end', () => {
  let db: Database.Database;
  let repo: string;
  let engine: WorkflowEngine;
  let runRepo: WorkflowRunRepository;

  const def = () => BUILTIN_WORKFLOW_TEMPLATES.find((t) => t.id === AI_AUTO_COMMIT_TEMPLATE_ID)!.definition;

  async function waitForTerminal(runId: string): Promise<WorkflowRun> {
    for (let i = 0; i < 150; i += 1) {
      await new Promise((res) => setTimeout(res, 20));
      const run = runRepo.findById(runId);
      if (run && ['completed', 'failed', 'cancelled'].includes(run.status)) return run;
    }
    throw new Error('run did not finish');
  }

  beforeEach(() => {
    db = new Database(':memory:');
    applyMigrations(db);
    runRepo = new WorkflowRunRepository(db);
    repo = mkdtempSync(join(tmpdir(), 'autocommit-'));
    initRepo(repo);
    const now = Date.now();
    db.prepare(
      `INSERT INTO projects (id, name, root_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`
    ).run('p1', 'proj', repo, now, now);
    // workflow_runs.workflow_id has a FK to workflows(id); seed the referenced row.
    db.prepare(
      `INSERT INTO workflows (id, project_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`
    ).run('wf1', 'p1', 'AI Auto Commit', now, now);

    const registry = new ActivityRegistry();
    registry.register(new GitStageActivity());
    registry.register(new GitCommitActivity());
    registry.register({
      type: 'generate_commit_message',
      invoke: async () => ({ status: 'completed', output: { subject: 'feat: x', message: 'feat: x' } }),
    } as any);

    const composite = new CompositeStepExecutor();
    composite.register(new ConditionStepExecutor());
    composite.register(new ActivityStepExecutorAdapter(registry, { run: async () => ({}) } as any));

    engine = new WorkflowEngine(db, () => {}, composite);
  });

  afterEach(() => { rmSync(repo, { recursive: true, force: true }); db.close(); });

  it('stages, generates, and commits with the AI message', async () => {
    writeFileSync(join(repo, 'a.txt'), 'hello');
    const run = await engine.startRun({
      workflowId: 'wf1', projectId: 'p1', definition: def(),
      triggerSource: 'manual', initiator: 'manual', actionKind: 'workflow', actionRef: 'wf1', trackingKey: 'wf1',
    });
    const final = await waitForTerminal(run.id);
    expect(final.status).toBe('completed');
    const log = execFileSync('git', ['log', '--oneline'], { cwd: repo }).toString();
    expect(log).toMatch(/feat: x/);
  });

  it('is a clean no-op when there are no changes', async () => {
    writeFileSync(join(repo, 'a.txt'), 'hello');
    execFileSync('git', ['add', '-A'], { cwd: repo });
    execFileSync('git', ['commit', '-qm', 'init'], { cwd: repo });
    const before = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo }).toString().trim();

    const run = await engine.startRun({
      workflowId: 'wf1', projectId: 'p1', definition: def(),
      triggerSource: 'manual', initiator: 'manual', actionKind: 'workflow', actionRef: 'wf1', trackingKey: 'wf1',
    });
    const final = await waitForTerminal(run.id);
    expect(final.status).toBe('completed');
    const after = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo }).toString().trim();
    expect(after).toBe(before);
  });
});
