import type { AgentRuntimeHarness } from '../../helpers/agent-runtime-harness';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  test,
  expect,
  openCodingSession,
  sendCodingMessage,
} from '../../helpers/agent-runtime-harness';

for (const runtime of ['claude', 'codex', 'cursor']) {
  test(`E07: ${runtime} uses the real MCP bridge with isolated concurrent sessions`, async ({
    app,
    page,
    context,
  }) => {
    await installProbe(app);
    const a = await app.configureCodingProject(runtime, undefined, '-a');
    const b = await app.configureCodingProject(runtime, undefined, '-b');
    const originalConfig = JSON.stringify({
      mcpServers: { 'user-server': { command: 'user-owned-command', args: ['preserve-me'] } },
      userSetting: true,
    });
    if (runtime === 'cursor') {
      for (const run of [a, b]) {
        await mkdir(path.join(run.cwd, '.cursor'));
        await writeFile(path.join(run.cwd, '.cursor/mcp.json'), originalConfig);
      }
    }
    const other = await context.newPage();
    await openCodingSession(page, app, a.project, a.session);
    await openCodingSession(other, app, b.project, b.session);
    await sendCodingMessage(page, 'E2E_MCP then fix addition');
    await sendCodingMessage(other, 'E2E_MCP then fix addition');
    for (const [tab, run, otherRun] of [
      [page, a, b],
      [other, b, a],
    ] as const) {
      await expect(
        tab.getByText(`E2E_${runtime.toUpperCase()}_CODING_COMPLETE`, { exact: true })
      ).toBeVisible();
      expect(
        JSON.parse(await readFile(path.join(app.directory, `mcp-${run.session.id}.json`), 'utf8'))
      ).toEqual({ sessionId: run.session.id, marker: `E2E_MCP_${run.session.id}` });
      expect(
        JSON.parse(await readFile(path.join(run.cwd, 'mcp-delivery-result.json'), 'utf8'))
      ).toMatchObject({ success: true, fileName: `mcp-delivery-${run.session.id}.txt` });
      await expect(tab.getByText(`E2E_MCP_${otherRun.session.id}`, { exact: true })).toHaveCount(0);
      await expect(tab.getByText('E2E_MCP_FORGED', { exact: true })).toHaveCount(0);
      await expect
        .poll(async () => (await app.api(`/api/sessions/${run.session.id}/run-state`)).isRunning)
        .toBe(false);
      if (runtime === 'cursor') {
        expect(JSON.parse(await readFile(path.join(run.cwd, '.cursor/mcp.json'), 'utf8'))).toEqual(
          JSON.parse(originalConfig)
        );
      }
    }
    await expect(
      readFile(path.join(app.directory, 'mcp-forged-session.json'))
    ).rejects.toMatchObject({ code: 'ENOENT' });
    expect(
      (await app.audit())
        .filter(event => event.mcpSessionId)
        .map(event => event.mcpSessionId)
        .sort()
    ).toEqual([a.session.id, b.session.id].sort());
  });
}

async function installProbe(app: AgentRuntimeHarness) {
  const directory = path.join(app.directory, 'data/plugins/e2e-mcp-probe');
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, 'plugin.json'),
    JSON.stringify({
      id: 'e2e.mcp-probe',
      name: 'E2E MCP probe',
      version: '1.0.0',
      description: 'Session-bound test tool',
      main: 'main.mjs',
    })
  );
  await writeFile(
    path.join(directory, 'main.mjs'),
    `
    import { writeFileSync } from 'node:fs';
    import path from 'node:path';
    export function activate(context) {
      context.tools.registerTool({ id: 'e2e_session_probe', name: 'e2e_session_probe', description: 'Verify the current session', parameters: { type: 'object', properties: { marker: { type: 'string' } } }, handler: async (args, ctx) => {
        const result = { sessionId: ctx.sessionId, marker: args.marker };
        writeFileSync(path.join(${JSON.stringify(app.directory)}, 'mcp-' + ctx.sessionId + '.json'), JSON.stringify(result));
        return JSON.stringify(result);
      } });
    }
    export function deactivate() {}
  `
  );
  await app.api('/api/plugins/discover', { method: 'POST' });
  await app.api('/api/plugins/e2e.mcp-probe/activate', { method: 'POST' });
}
