import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createWorkflowRoutes } from '../routes.js';
import type { WorkflowStepTypeMeta } from '@zclaudia/shared/features/workflows';

function makeApp(activityMeta: WorkflowStepTypeMeta[]) {
  const app = express();
  const fakeService = { } as never;
  app.use('/api', createWorkflowRoutes(fakeService, undefined, {
    activityRegistry: { listMeta: () => activityMeta },
  }));
  return app;
}

describe('GET /api/workflow-step-types', () => {
  it('merges activity meta and dedupes git_commit (activity precedence)', async () => {
    const app = makeApp([
      { type: 'git_commit', name: 'Git Commit', description: 'Stage and commit', category: 'Git', source: 'activity' },
      { type: 'git_stage', name: 'Git Stage', description: 'Stage all', category: 'Git', source: 'activity' },
      { type: 'generate_commit_message', name: 'Generate Commit Message', description: 'AI message', category: 'AI', source: 'activity' },
    ]);
    const res = await request(app).get('/api/workflow-step-types');
    expect(res.status).toBe(200);
    const data = res.body.data as WorkflowStepTypeMeta[];

    // git_commit appears exactly once, sourced from the activity.
    const gitCommits = data.filter((m) => m.type === 'git_commit');
    expect(gitCommits).toHaveLength(1);
    expect(gitCommits[0].source).toBe('activity');

    // The previously-invisible activities are present.
    expect(data.some((m) => m.type === 'git_stage')).toBe(true);
    expect(data.some((m) => m.type === 'generate_commit_message')).toBe(true);

    // A non-activity builtin is still present.
    expect(data.some((m) => m.type === 'shell')).toBe(true);
  });
});
