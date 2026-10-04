import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
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
}, testInfo) => {
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

    // The composer shows the session's language server as ready, with details on hover.
    const indicator = page.getByTestId('language-server-indicator');
    await expect(indicator).toHaveAttribute('data-state', 'ready', { timeout: 20_000 });
    await indicator.hover();
    const popover = page.getByTestId('language-server-popover');
    await expect(popover).toContainText('TypeScript');
    await expect(popover).toContainText('Ready');
    await testInfo.attach('lsp-indicator', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
    await page.keyboard.press('Escape');

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

test('LSP: Python works out of the box with the bundled Pyright', async ({ app, page }) => {
  const { project, cwd } = await app.configureCodingProject('codex', undefined, '-lsp-python');
  await writeFile(path.join(cwd, 'pyproject.toml'), '[project]\nname = "p"\nversion = "0"\n');

  const upstream = await startCompletionFixture(request => {
    if (!request.tools?.some(tool => tool.function.name === 'Write'))
      return { content: 'LSP Python session' };
    const last = request.messages.at(-1);
    if (last?.role === 'user' && JSON.stringify(last.content).includes('warm up'))
      return { content: 'E2E_PY_WARM' };
    if (last?.role === 'user')
      return {
        tool: 'Write',
        arguments: {
          file_path: 'app.py',
          content: 'def f(x: int) -> int:\n    return x\n\nf("a")\n',
        },
      };
    return { content: 'E2E_PY_DONE' };
  });
  try {
    const llm = await app.api('/api/llm-profiles', {
      method: 'POST',
      body: JSON.stringify({
        name: 'LSP Python model fixture',
        providerType: 'openai',
        baseUrl: upstream.baseUrl,
        apiKey: 'e2e-placeholder',
        models: [{ modelId: 'e2e-lsp', dialect: 'openai', contextWindow: 32768, maxTokens: 1024 }],
      }),
    });
    const profile = await app.api('/api/agent-profiles', {
      method: 'POST',
      body: JSON.stringify({
        name: 'LSP Python E2E Agent',
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
        name: 'LSP Python session',
        agentProfileId: profile.id,
      }),
    });
    await openCodingSession(page, app, project, session);
    const messages = page.getByTestId('message-list');

    await sendCodingMessage(page, 'Please warm up.');
    await expect(messages.getByText('E2E_PY_WARM', { exact: true })).toBeVisible();
    const indicator = page.getByTestId('language-server-indicator');
    await expect(indicator).toHaveAttribute('data-state', 'ready', { timeout: 30_000 });

    await sendCodingMessage(page, 'Call f with a string in app.py.');
    await expect(messages.getByText('E2E_PY_DONE', { exact: true })).toBeVisible();
    expect(upstream.errors).toEqual([]);
    const writeResult = JSON.stringify(
      upstream.requests
        .at(-1)!
        .messages.filter(m => m.role === 'tool')
        .at(-1)
    );
    expect(writeResult).toContain('Diagnostics (Python (Pyright)): 1 new error introduced');
    expect(writeResult).toMatch(/app\.py:4:\d+ Argument of type/);
  } finally {
    await upstream.stop();
  }
});

test('LSP: the model renames a symbol across files in one RenameSymbol call', async ({
  app,
  page,
}) => {
  const { project, cwd } = await app.configureCodingProject('codex', undefined, '-lsp-rename');
  await mkdir(path.join(cwd, 'src'), { recursive: true });
  await mkdir(path.join(cwd, 'node_modules'), { recursive: true });
  await symlink(typescriptPackage, path.join(cwd, 'node_modules', 'typescript'), 'dir');
  await writeFile(path.join(cwd, 'package.json'), '{"name":"lsp-rename-e2e","private":true}\n');
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
    if (!request.tools?.some(tool => tool.function.name === 'RenameSymbol'))
      return { content: 'LSP rename session' };
    if (request.messages.at(-1)?.role === 'user')
      return {
        tool: 'RenameSymbol',
        arguments: { file_path: 'src/main.ts', line: 3, symbol: 'greet', new_name: 'welcome' },
      };
    return { content: 'E2E_LSP_RENAME_DONE' };
  });
  try {
    const llm = await app.api('/api/llm-profiles', {
      method: 'POST',
      body: JSON.stringify({
        name: 'LSP rename model fixture',
        providerType: 'openai',
        baseUrl: upstream.baseUrl,
        apiKey: 'e2e-placeholder',
        models: [{ modelId: 'e2e-lsp', dialect: 'openai', contextWindow: 32768, maxTokens: 1024 }],
      }),
    });
    const profile = await app.api('/api/agent-profiles', {
      method: 'POST',
      body: JSON.stringify({
        name: 'LSP Rename E2E Agent',
        runtimeType: 'zclaudia',
        llmProfileId: llm.id,
        model: 'e2e-lsp',
        enabledTools: ['Read', 'RenameSymbol'],
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
        name: 'LSP rename session',
        agentProfileId: profile.id,
      }),
    });
    await openCodingSession(page, app, project, session);
    await sendCodingMessage(page, 'Rename greet to welcome.');
    const messages = page.getByTestId('message-list');
    await expect(messages.getByText('E2E_LSP_RENAME_DONE', { exact: true })).toBeVisible({
      timeout: 45_000,
    });
    expect(upstream.errors).toEqual([]);
    const toolResult = JSON.stringify(
      upstream.requests
        .at(-1)!
        .messages.filter(m => m.role === 'tool')
        .at(-1)
    );
    expect(toolResult).toContain('Renamed greet → welcome');
    expect(toolResult).toContain('Files changed: 2');
    expect(await readFile(path.join(cwd, 'src', 'lib.ts'), 'utf8')).toContain('function welcome');
    expect(await readFile(path.join(cwd, 'src', 'main.ts'), 'utf8')).toBe(
      "import { welcome } from './lib';\n\nexport const out = welcome('a');\n"
    );
    // The collapsed group names the rename; its card adds the file.
    await expect(messages.getByText('greet → welcome', { exact: true })).toBeVisible();
    await messages.getByText('1 tool call').click();
    await expect(messages.getByText('greet → welcome · src/main.ts')).toBeVisible();
    // Expanded, the card shows each changed file's diff.
    await messages.getByText('greet → welcome · src/main.ts').click();
    await expect(messages.getByText('src/lib.ts', { exact: true })).toBeVisible();
    await expect(messages.getByText('src/main.ts', { exact: true })).toBeVisible();
    await page.screenshot({
      path: '/private/tmp/claude-501/-Users-zhvala-SourceCode-zclaudia/80655315-71e9-4cc4-b5c1-aa9ab2f3b067/scratchpad/rename-card.png',
    });
  } finally {
    await upstream.stop();
  }
});

test('LSP: the file viewer marks type errors once the user checks types', async ({ app, page }) => {
  const { project, cwd } = await app.configureCodingProject('codex', undefined, '-lsp-viewer');
  await mkdir(path.join(cwd, 'src'), { recursive: true });
  await mkdir(path.join(cwd, 'node_modules'), { recursive: true });
  await symlink(typescriptPackage, path.join(cwd, 'node_modules', 'typescript'), 'dir');
  await writeFile(path.join(cwd, 'package.json'), '{"name":"lsp-viewer-e2e","private":true}\n');
  await writeFile(
    path.join(cwd, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { strict: true, noEmit: true }, include: ['src'] })
  );
  await writeFile(
    path.join(cwd, 'src', 'app.ts'),
    "export const a = 1;\nexport const b: string = 2;\nexport const c = 'ok';\n"
  );

  const upstream = await startCompletionFixture(request =>
    request.tools?.length ? { content: 'Look at `src/app.ts:2`.' } : { content: 'Viewer session' }
  );
  try {
    const llm = await app.api('/api/llm-profiles', {
      method: 'POST',
      body: JSON.stringify({
        name: 'LSP viewer model fixture',
        providerType: 'openai',
        baseUrl: upstream.baseUrl,
        apiKey: 'e2e-placeholder',
        models: [{ modelId: 'e2e-lsp', dialect: 'openai', contextWindow: 32768, maxTokens: 1024 }],
      }),
    });
    const profile = await app.api('/api/agent-profiles', {
      method: 'POST',
      body: JSON.stringify({
        name: 'LSP Viewer E2E Agent',
        runtimeType: 'zclaudia',
        llmProfileId: llm.id,
        model: 'e2e-lsp',
        enabledTools: ['Read'],
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
        name: 'LSP viewer session',
        agentProfileId: profile.id,
      }),
    });
    await openCodingSession(page, app, project, session);
    await sendCodingMessage(page, 'Where is the problem?');
    const reference = page.getByTestId('message-list').getByText('src/app.ts:2');
    await expect(reference).toBeVisible({ timeout: 45_000 });

    // The run started the workspace's server; stop it, so the viewer starts cold.
    await app.api('/api/language-servers', {
      method: 'PUT',
      body: JSON.stringify({ enabled: false }),
    });
    await app.api('/api/language-servers', {
      method: 'PUT',
      body: JSON.stringify({ enabled: true }),
    });

    await reference.click();
    // The side panel is narrow: give the code the room the file tree takes.
    await page.getByRole('button', { name: 'Hide file tree' }).click();
    const checkTypes = page.getByTestId('check-types');
    await expect(checkTypes).toBeVisible({ timeout: 15_000 });
    await checkTypes.click();
    const marker = page.getByTestId('diagnostic-marker');
    await expect(marker).toBeVisible({ timeout: 30_000 });
    await expect(marker).toHaveAttribute('data-severity', 'error');
    await expect(page.getByTestId('diagnostics-status')).toHaveText('1 error');
    await marker.hover();
    await expect(page.getByTestId('diagnostic-popover')).toContainText(
      "Type 'number' is not assignable to type 'string'."
    );
    await page.screenshot({
      path: '/private/tmp/claude-501/-Users-zhvala-SourceCode-zclaudia/80655315-71e9-4cc4-b5c1-aa9ab2f3b067/scratchpad/viewer-diagnostics.png',
    });
    // The viewer's lease keeps the server running.
    const overview = await app.api('/api/language-servers');
    expect(overview.servers).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'typescript', leases: 1 })])
    );
  } finally {
    await upstream.stop();
  }
});
