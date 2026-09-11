import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { request as httpRequest } from 'node:http';
import { test, expect } from '../../helpers/agent-runtime-artifact-harness';

test('E01: partial startup rejects runtime requests and becomes ready after registration', async ({
  artifactApp: app,
  bundle,
  page,
}) => {
  const entry = path.join(bundle, 'builtin-plugins/cursor/dist/main.js');
  const original = await readFile(entry, 'utf8');
  await writeFile(
    entry,
    `import { existsSync as e2eStartupReleased } from 'node:fs';\nwhile (!e2eStartupReleased(process.env.E2E_RUNTIME_AUDIT + '.release')) await new Promise(resolve => setTimeout(resolve, 20));\n${original}`
  );
  await app.start({ waitForReady: false });
  await expect.poll(() => app.logs.includes('Activated plugin: com.zclaudia.codex')).toBe(true);
  expect(app.logs).not.toContain('Activated plugin: com.zclaudia.cursor');
  const health = async () => (await fetch(`${app.url}/health`)).json();
  expect((await health()).agentRuntimes).toBe('initializing');
  for (const [endpoint, method] of [
    ['/api/agent-profiles', 'GET'],
    ['/api/agent-runtimes', 'GET'],
    ['/api/providers/type/cursor/capabilities', 'GET'],
    ['/api/plugins', 'GET'],
    ['/api/plugins/com.zclaudia.claude/deactivate', 'POST'],
    ['/api/managed-runtimes', 'GET'],
    ['/api/projects', 'POST'],
    ['/api/sessions', 'POST'],
  ]) {
    const response = await fetch(app.url + endpoint, {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(method === 'POST' ? { body: '{}' } : {}),
    });
    expect(response.status).toBe(503);
    expect(response.headers.get('retry-after')).toBe('1');
    expect(await response.json()).toMatchObject({
      success: false,
      error: { code: 'RUNTIMES_INITIALIZING' },
    });
  }
  for (const endpoint of ['/ws', '/ws/backend-facade']) {
    const response = await new Promise<{ status?: number; body: string }>((resolve, reject) => {
      const request = httpRequest(app.url + endpoint, {
        headers: {
          Connection: 'Upgrade',
          Upgrade: 'websocket',
          'Sec-WebSocket-Version': '13',
          'Sec-WebSocket-Key': Buffer.from('1234567890123456').toString('base64'),
        },
      });
      const timer = setTimeout(() => {
        request.destroy();
        reject(new Error('Startup WebSocket was not rejected'));
      }, 5000);
      request.once('response', res => {
        let body = '';
        res.on('data', chunk => {
          body += chunk.toString();
        });
        res.on('end', () => {
          clearTimeout(timer);
          resolve({ status: res.statusCode, body });
        });
      });
      request.once('upgrade', (_res, socket) => {
        clearTimeout(timer);
        socket.destroy();
        reject(new Error('WebSocket accepted before runtime registration finished'));
      });
      request.once('error', error => {
        clearTimeout(timer);
        reject(error);
      });
      request.end();
    });
    expect(response.status).toBe(503);
    expect(JSON.parse(response.body).error.code).toBe('RUNTIMES_INITIALIZING');
  }
  await page.goto(app.url);
  await writeFile(path.join(app.directory, 'cli-audit.jsonl.release'), 'continue startup');
  await expect.poll(async () => (await health()).agentRuntimes).toBe('ready');
  expect(
    (await app.api('/api/plugins')).filter(
      (p: any) => p.source === 'builtin' && p.status === 'active'
    )
  ).toHaveLength(3);
  expect((await app.api('/api/projects')).filter((p: any) => !p.isInternal)).toHaveLength(0);
  await page.getByRole('button', { name: 'Extensions', exact: true }).click();
  await page.getByRole('button', { name: 'Built-in', exact: true }).click();
  for (const runtime of ['Claude', 'Codex', 'Cursor']) {
    await expect(
      page.getByRole('switch', { name: `Disable ${runtime} Agent`, exact: true })
    ).toBeVisible();
  }
});
