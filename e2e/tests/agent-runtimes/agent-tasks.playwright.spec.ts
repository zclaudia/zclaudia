import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test, expect, openCodingSession } from '../../helpers/agent-runtime-harness';

for (const runtime of ['claude', 'codex', 'cursor']) {
  test(`E19: agent task uses project ${runtime} runtime and persists its coding result`, async ({
    app,
    page,
  }) => {
    const { project, cwd } = await app.configureCodingProject(runtime);
    const workflow = await app.api(`/api/projects/${project.id}/workflows`, {
      method: 'POST',
      body: JSON.stringify({
        name: `${runtime} task routing`,
        status: 'active',
        definition: {
          entryNodeId: 'coding',
          edges: [],
          nodes: [
            {
              id: 'coding',
              name: `Task with ${runtime}`,
              type: 'task',
              position: { x: 0, y: 0 },
              config: {
                taskType: 'agent',
                prompt: 'Fix addition in add.mjs and run its test.',
                wait: true,
              },
            },
          ],
        },
      }),
    });
    const run = await app.api(`/api/workflows/${workflow.id}/trigger`, { method: 'POST' });
    await expect
      .poll(async () => (await app.api(`/api/workflow-runs/${run.id}`)).run.status)
      .toBe('completed');
    const completed = await app.api(`/api/workflow-runs/${run.id}`);
    expect(completed.stepRuns).toHaveLength(1);
    expect(completed.stepRuns[0].output).toMatchObject({
      status: 'completed',
      result: { text: `E2E_${runtime.toUpperCase()}_CODING_COMPLETE` },
    });
    expect(await readFile(path.join(cwd, 'add.mjs'), 'utf8')).toContain('a + b');
    const audit = await app.audit();
    expect(audit[0]).toMatchObject({ runtime, cwd });
    expect(
      audit.every(
        event => event.runtime === runtime && (event.cwd === undefined || event.cwd === cwd)
      )
    ).toBe(true);
    expect(audit.some(event => event.testExitCode === 0)).toBe(true);
    const sessions = await app.api(`/api/sessions?projectId=${project.id}`);
    const taskSession = sessions.find((s: any) => s.type === 'agent');
    expect(taskSession).toBeTruthy();
    await openCodingSession(page, app, project, taskSession);
    await expect(
      page.getByText(`E2E_${runtime.toUpperCase()}_CODING_COMPLETE`, { exact: true })
    ).toBeVisible();
  });

  test(`E19: agent task with disabled ${runtime} fails without fallback or hanging`, async ({
    app,
  }) => {
    const { project, cwd } = await app.configureCodingProject(runtime);
    await app.api(`/api/plugins/com.zclaudia.${runtime}/deactivate`, { method: 'POST' });
    const workflow = await app.api(`/api/projects/${project.id}/workflows`, {
      method: 'POST',
      body: JSON.stringify({
        name: `${runtime} unavailable task`,
        status: 'active',
        definition: {
          entryNodeId: 'coding',
          edges: [],
          nodes: [
            {
              id: 'coding',
              name: 'Unavailable agent',
              type: 'task',
              position: { x: 0, y: 0 },
              config: { taskType: 'agent', prompt: 'Fix addition in add.mjs.', wait: true },
            },
          ],
        },
      }),
    });
    const run = await app.api(`/api/workflows/${workflow.id}/trigger`, { method: 'POST' });
    await expect
      .poll(async () => (await app.api(`/api/workflow-runs/${run.id}`)).run.status)
      .toBe('failed');
    const failed = await app.api(`/api/workflow-runs/${run.id}`);
    expect(failed.stepRuns[0].error).toMatch(/runtime|adapter/i);
    expect(await readFile(path.join(cwd, 'add.mjs'), 'utf8')).toContain('a - b');
    await expect(app.audit()).rejects.toMatchObject({ code: 'ENOENT' });
  });
}
