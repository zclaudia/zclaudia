import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import {
  test,
  expect,
  openCodingSession,
  sendCodingMessage,
} from '../../helpers/agent-runtime-harness';
import { startCompletionFixture } from '../../helpers/completion-fixture';

// The project's own TypeScript, resolved the way the server package sees it.
const serverRequire = createRequire(
  path.resolve(import.meta.dirname, '../../../server/package.json')
);
const typescriptPackage = path.dirname(serverRequire.resolve('typescript/package.json'));

test('LSP: the ZClaudia runtime tells the model which type errors its edit introduced', async ({
  app,
  page,
}) => {
  const { project, cwd } = await app.configureCodingProject('codex', undefined, '-lsp');
  await mkdir(path.join(cwd, 'src'), { recursive: true });
  await mkdir(path.join(cwd, 'node_modules'), { recursive: true });
  await symlink(typescriptPackage, path.join(cwd, 'node_modules', 'typescript'), 'dir');
  await writeFile(path.join(cwd, 'package.json'), '{"name":"lsp-e2e","private":true}\n');
  await writeFile(
    path.join(cwd, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { strict: true, noEmit: true }, include: ['src'] })
  );

  const upstream = await startCompletionFixture(request => {
    if (!request.tools?.some(tool => tool.function.name === 'Write'))
      return { content: 'LSP session' };
    const last = request.messages.at(-1);
    if (last?.role === 'user' && JSON.stringify(last.content).includes('warm up'))
      return { content: 'E2E_LSP_WARM' };
    if (last?.role === 'user')
      return {
        tool: 'Write',
        arguments: { file_path: 'src/a.ts', content: 'export const a: string = 1;\n' },
      };
    return { content: 'E2E_LSP_DONE' };
  });
  try {
    const llm = await app.api('/api/llm-profiles', {
      method: 'POST',
      body: JSON.stringify({
        name: 'LSP model fixture',
        providerType: 'openai',
        baseUrl: upstream.baseUrl,
        apiKey: 'e2e-placeholder',
        models: [{ modelId: 'e2e-lsp', dialect: 'openai', contextWindow: 32768, maxTokens: 1024 }],
      }),
    });
    const profile = await app.api('/api/agent-profiles', {
      method: 'POST',
      body: JSON.stringify({
        name: 'LSP E2E Agent',
        runtimeType: 'zclaudia',
        llmProfileId: llm.id,
        model: 'e2e-lsp',
        enabledTools: ['Read', 'Write'],
      }),
    });
    await app.api(`/api/projects/${project.id}`, {
      method: 'PUT',
      body: JSON.stringify({ defaultAgentProfileId: profile.id }),
    });
    const session = await app.api('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({
        projectId: project.id,
        name: 'LSP session',
        agentProfileId: profile.id,
      }),
    });
    await openCodingSession(page, app, project, session);
    const messages = page.getByTestId('message-list');

    // Turn 1 leases the workspace's language server (warm-up). The fixture
    // answers instantly, so editing in this turn would race the start-up.
    await sendCodingMessage(page, 'Please warm up.');
    await expect(messages.getByText('E2E_LSP_WARM', { exact: true })).toBeVisible();
    await expect
      .poll(
        async () =>
          (await app.api('/api/debug/processes')).filter(
            (record: any) => record.source === 'language_server' && record.status === 'running'
          ).length,
        { timeout: 30_000 }
      )
      .toBe(1);

    // Turn 2 writes a type error; the Write result the model receives must name it.
    await sendCodingMessage(page, 'Add the constant a to src/a.ts.');
    await expect(messages.getByText('E2E_LSP_DONE', { exact: true })).toBeVisible();
    expect(upstream.errors).toEqual([]);
    const final = upstream.requests.at(-1)!;
    const writeResult = JSON.stringify(final.messages.filter(m => m.role === 'tool').at(-1));
    expect(writeResult).toContain(
      'Diagnostics (TypeScript): 1 new error introduced by this change'
    );
    expect(writeResult).toContain(
      "src/a.ts:1:14 Type 'number' is not assignable to type 'string'."
    );
  } finally {
    await upstream.stop();
  }
});

test('LSP: the model can ask the language server for a definition by symbol', async ({
  app,
  page,
}) => {
  const { project, cwd } = await app.configureCodingProject('codex', undefined, '-lsp-tool');
  await mkdir(path.join(cwd, 'src'), { recursive: true });
  await mkdir(path.join(cwd, 'node_modules'), { recursive: true });
  await symlink(typescriptPackage, path.join(cwd, 'node_modules', 'typescript'), 'dir');
  await writeFile(path.join(cwd, 'package.json'), '{"name":"lsp-tool-e2e","private":true}\n');
  await writeFile(
    path.join(cwd, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { strict: true, noEmit: true }, include: ['src'] })
  );
  await writeFile(
    path.join(cwd, 'src', 'lib.ts'),
    'export function greet(name: string): string {\n  return name;\n}\n'
  );
  await writeFile(
    path.join(cwd, 'src', 'main.ts'),
    "import { greet } from './lib';\n\nexport const out = greet('a');\n"
  );

  const upstream = await startCompletionFixture(request => {
    if (!request.tools?.some(tool => tool.function.name === 'LSPTool'))
      return { content: 'LSP tool session' };
    if (request.messages.at(-1)?.role === 'user')
      return {
        tool: 'LSPTool',
        arguments: { action: 'definition', file: 'src/main.ts', line: 3, symbol: 'greet' },
      };
    return { content: 'E2E_LSP_TOOL_DONE' };
  });
  try {
    const llm = await app.api('/api/llm-profiles', {
      method: 'POST',
      body: JSON.stringify({
        name: 'LSP tool model fixture',
        providerType: 'openai',
        baseUrl: upstream.baseUrl,
        apiKey: 'e2e-placeholder',
        models: [{ modelId: 'e2e-lsp', dialect: 'openai', contextWindow: 32768, maxTokens: 1024 }],
      }),
    });
    const profile = await app.api('/api/agent-profiles', {
      method: 'POST',
      body: JSON.stringify({
        name: 'LSP Tool E2E Agent',
        runtimeType: 'zclaudia',
        llmProfileId: llm.id,
        model: 'e2e-lsp',
        enabledTools: ['Read', 'LSPTool'],
      }),
    });
    await app.api(`/api/projects/${project.id}`, {
      method: 'PUT',
      body: JSON.stringify({ defaultAgentProfileId: profile.id }),
    });
    const session = await app.api('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({
        projectId: project.id,
        name: 'LSP tool session',
        agentProfileId: profile.id,
      }),
    });
    await openCodingSession(page, app, project, session);
    await sendCodingMessage(page, 'Where is greet defined?');
    await expect(
      page.getByTestId('message-list').getByText('E2E_LSP_TOOL_DONE', { exact: true })
    ).toBeVisible({ timeout: 45_000 });
    expect(upstream.errors).toEqual([]);
    const toolResult = JSON.stringify(
      upstream.requests
        .at(-1)!
        .messages.filter(m => m.role === 'tool')
        .at(-1)
    );
    expect(toolResult).toContain('src/lib.ts');
    expect(toolResult).toContain('export function greet(name: string): string {');
  } finally {
    await upstream.stop();
  }
});
