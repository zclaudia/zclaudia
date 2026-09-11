import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  test,
  expect,
  openCodingSession,
  sendCodingMessage,
} from '../../helpers/agent-runtime-harness';
import { startCompletionFixture } from '../../helpers/completion-fixture';

test('E22: ZClaudia runtime still executes coding tools and retains its UI history', async ({
  app,
  page,
}, testInfo) => {
  testInfo.annotations.push({
    type: 'shell-isolation',
    description: process.env.ZCLAUDIA_E2E_SANDBOX_PROFILE
      ? 'Outer artifact sandbox retained; approved per-command exception avoids nested sandbox_apply.'
      : 'Default host per-command sandbox and user approval.',
  });
  const { project, cwd } = await app.configureCodingProject('codex');
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  const upstream = await startCompletionFixture(request => {
    if (!request.tools?.some(tool => tool.function.name === 'Write'))
      return { content: 'Native coding session' };
    const results = request.messages.filter(message => message.role === 'tool');
    if (results.length === 0) return { tool: 'Read', arguments: { file_path: 'add.mjs' } };
    if (results.length === 1)
      return {
        tool: 'Write',
        arguments: { file_path: 'add.mjs', content: 'export const add = (a, b) => a + b;\n' },
      };
    if (results.length === 2)
      return {
        tool: 'Bash',
        arguments: {
          command: `${quote(process.env.ZCLAUDIA_E2E_NODE_PATH ?? process.execPath)} --test add.test.mjs`,
          // macOS rejects sandbox_apply from inside the artifact harness's
          // seatbelt. The outer sandbox still denies source reads and artifact
          // writes; exercise the host's explicit, approved exception path.
          ...(process.env.ZCLAUDIA_E2E_SANDBOX_PROFILE
            ? {
                sandbox_mode: 'unsandboxed',
                privilege_reason:
                  'Run the fixture test inside the existing outer artifact sandbox.',
              }
            : {}),
        },
      };
    if (results.length !== 3) throw new Error('Unexpected native tool loop');
    return { content: 'E2E_NATIVE_CODING_COMPLETE' };
  });
  try {
    const llm = await app.api('/api/llm-profiles', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Native runtime model fixture',
        providerType: 'openai',
        baseUrl: upstream.baseUrl,
        apiKey: 'e2e-placeholder',
        models: [
          { modelId: 'e2e-native', dialect: 'openai', contextWindow: 32768, maxTokens: 1024 },
        ],
      }),
    });
    const profile = await app.api('/api/agent-profiles', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Native E2E Agent',
        runtimeType: 'zclaudia',
        llmProfileId: llm.id,
        model: 'e2e-native',
        enabledTools: ['Read', 'Write', 'Bash'],
      }),
    });
    await page.goto(app.url);
    await page.getByRole('button', { name: 'Agents', exact: true }).click();
    await page.getByRole('button', { name: profile.name, exact: true }).click();
    await expect(page.getByLabel('LLM Profile', { exact: true })).toBeVisible();
    await expect(page.getByLabel('CLI Path (optional)', { exact: true })).toHaveCount(0);
    await page.getByLabel('Profile name', { exact: true }).fill('Edited native agent');
    await page.getByLabel('Profile description', { exact: true }).fill('Native profile UI edit');
    await page.getByLabel('Profile description', { exact: true }).blur();
    await expect
      .poll(async () =>
        (await app.api('/api/agent-profiles')).find((item: any) => item.id === profile.id)
      )
      .toMatchObject({
        name: 'Edited native agent',
        description: 'Native profile UI edit',
        runtimeType: 'zclaudia',
        llmProfileId: llm.id,
        model: 'e2e-native',
        enabledTools: ['Read', 'Write', 'Bash'],
      });
    await app.api(`/api/projects/${project.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        defaultAgentProfileId: profile.id,
        agentPermissionOverride: { escalateAlways: ['Bash'], aiReview: { enabled: false } },
      }),
    });
    const session = await app.api('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({
        projectId: project.id,
        name: 'Native coding session',
        agentProfileId: profile.id,
      }),
    });
    await openCodingSession(page, app, project, session);
    await sendCodingMessage(page, 'Fix addition in add.mjs and run its test.');
    await expect(page.getByRole('button', { name: 'Allow', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Allow', exact: true }).click();
    if (process.env.ZCLAUDIA_E2E_SANDBOX_PROFILE) {
      await expect(page.getByRole('button', { name: 'Allow', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Allow', exact: true }).click();
    }
    await expect(
      page.getByTestId('message-list').getByText('E2E_NATIVE_CODING_COMPLETE', { exact: true })
    ).toBeVisible();
    expect(upstream.errors).toEqual([]);
    const codingRequests = upstream.requests.filter(request =>
      request.tools?.some(tool => tool.function.name === 'Write')
    );
    expect(codingRequests).toHaveLength(4);
    expect(upstream.requests.every(request => request.model === 'e2e-native')).toBe(true);
    const toolResults = codingRequests[3].messages.filter(message => message.role === 'tool');
    expect(JSON.stringify(toolResults[2].content)).toContain('pass 1');
    expect(await readFile(path.join(cwd, 'add.mjs'), 'utf8')).toContain('a + b');
    await expect(app.audit()).rejects.toMatchObject({ code: 'ENOENT' });
    await openCodingSession(page, app, project, session);
    await expect(
      page.getByTestId('message-list').getByText('E2E_NATIVE_CODING_COMPLETE', { exact: true })
    ).toBeVisible();
  } finally {
    await upstream.stop();
  }
});

test('E22: built-in panel preferences remain independent of runtime enablement', async ({
  app,
  page,
}) => {
  const profiles = await app.api('/api/agent-profiles');
  await page.goto(app.url);
  await page.getByRole('button', { name: 'Extensions', exact: true }).click();
  await page.getByRole('button', { name: 'Built-in', exact: true }).click();
  await page.getByRole('switch', { name: 'Disable Terminal', exact: true }).click();
  await expect(page.getByRole('switch', { name: 'Enable Terminal', exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Extensions', exact: true }).click();
  await page.getByRole('button', { name: 'Built-in', exact: true }).click();
  await expect(page.getByRole('switch', { name: 'Enable Terminal', exact: true })).toBeVisible();
  for (const runtime of ['Claude', 'Codex', 'Cursor']) {
    await expect(
      page.getByRole('switch', { name: `Disable ${runtime} Agent`, exact: true })
    ).toBeVisible();
  }
  await page.getByRole('switch', { name: 'Enable Terminal', exact: true }).click();
  await expect(page.getByRole('switch', { name: 'Disable Terminal', exact: true })).toBeVisible();
  expect(
    (await app.api('/api/plugins'))
      .filter((p: any) => p.source === 'builtin')
      .every((p: any) => p.status === 'active')
  ).toBe(true);
  expect((await app.api('/api/agent-profiles')).map((p: any) => p.id).sort()).toEqual(
    profiles.map((p: any) => p.id).sort()
  );
});
