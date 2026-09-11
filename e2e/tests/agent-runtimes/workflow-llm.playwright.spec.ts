import { test, expect } from '../../helpers/agent-runtime-harness';
import { startCompletionFixture } from '../../helpers/completion-fixture';

test('E19: workflow ai_prompt retains its explicit LLM route with an external project agent', async ({
  app,
}) => {
  const { project } = await app.configureCodingProject('codex');
  const upstream = await startCompletionFixture(() => ({
    content: JSON.stringify({ result: 'E2E_WORKFLOW_LLM_COMPLETE' }),
  }));
  try {
    const llm = await app.api('/api/llm-profiles', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Local workflow fixture',
        providerType: 'openai',
        baseUrl: upstream.baseUrl,
        apiKey: 'e2e-placeholder',
        models: [
          { modelId: 'e2e-workflow', dialect: 'openai', contextWindow: 32768, maxTokens: 1024 },
        ],
      }),
    });
    const workflow = await app.api(`/api/projects/${project.id}/workflows`, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Existing LLM workflow',
        status: 'active',
        definition: {
          entryNodeId: 'prompt',
          edges: [],
          nodes: [
            {
              id: 'prompt',
              name: 'LLM prompt',
              type: 'ai_prompt',
              position: { x: 0, y: 0 },
              config: {
                prompt: 'Return the fixture result.',
                llmProfileId: llm.id,
                model: 'e2e-workflow',
                toolset: 'none',
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
    expect(completed.stepRuns[0].output).toMatchObject({ result: 'E2E_WORKFLOW_LLM_COMPLETE' });
    expect(upstream.errors).toEqual([]);
    expect(upstream.requests).toHaveLength(1);
    expect(upstream.requests[0].model).toBe('e2e-workflow');
    expect(upstream.requests[0].tools ?? []).toHaveLength(0);
    await expect(app.audit()).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    await upstream.stop();
  }
});

test('E19: workflow ai_prompt without an LLM fails visibly instead of invoking the project CLI', async ({
  app,
}, testInfo) => {
  const { project } = await app.configureCodingProject('codex');
  // Startup creates a keyless default LLM record. Remove that placeholder in
  // this private backend to exercise the genuinely absent-profile case.
  for (const profile of await app.api('/api/llm-profiles')) {
    await app.api(`/api/llm-profiles/${profile.id}`, { method: 'DELETE' });
  }
  expect(await app.api('/api/llm-profiles')).toHaveLength(0);
  const workflow = await app.api(`/api/projects/${project.id}/workflows`, {
    method: 'POST',
    body: JSON.stringify({
      name: 'LLM required workflow',
      status: 'active',
      definition: {
        entryNodeId: 'prompt',
        edges: [],
        nodes: [
          {
            id: 'prompt',
            name: 'LLM prompt',
            type: 'ai_prompt',
            position: { x: 0, y: 0 },
            config: { prompt: 'Do not select the CLI implicitly.' },
          },
        ],
      },
    }),
  });
  const run = await app.api(`/api/workflows/${workflow.id}/trigger`, { method: 'POST' });
  try {
    await expect
      .poll(async () => (await app.api(`/api/workflow-runs/${run.id}`)).run.status)
      .toBe('failed');
  } finally {
    await testInfo.attach('workflow-state', {
      body: JSON.stringify(await app.api(`/api/workflow-runs/${run.id}`), null, 2),
      contentType: 'application/json',
    });
  }
  expect((await app.api(`/api/workflow-runs/${run.id}`)).stepRuns[0].error).toBe(
    'No provider configured'
  );
  await expect(app.audit()).rejects.toMatchObject({ code: 'ENOENT' });
});
