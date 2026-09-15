import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { type AddressInfo } from 'node:net';
import { execFileSync } from 'node:child_process';
import { CodexAppServerClient } from '../app-server-client.js';
import {
  buildCodexSdkEnvironment,
  buildSdkConfigArgs,
  buildSdkConfigToml,
  writeSdkConfig,
} from '../config.js';
import type { PermissionCallback, ProviderRuntimeEvent } from '@zclaudia/plugin-sdk/providers';

/**
 * P0 local-engine probe for the Codex runtime (design:
 * docs/plans/2026-09-11-codex-dual-mode-runtime-design.md §11).
 *
 * Drives the REAL `codex app-server` binary through the plugin's real client,
 * config writers and environment builder against a local OpenAI Responses
 * HTTP fixture. Verifies env_key authentication with no login, connection
 * re-lock against project-level config pollution, and strict resume — no
 * network beyond 127.0.0.1. Skipped when no codex binary is available.
 */

const PROFILE_KEY = 'sk-profile-probe-0001';
const INHERITED_OPENAI_KEY = 'sk-inherited-openai-DO-NOT-USE';
const DEV_INSTRUCTIONS_MARKER = 'HOST_DEV_INSTRUCTIONS_5150';
const BOUND_MODEL = 'gpt-probe-model';

function locateCodexBinary(): string | null {
  if (process.env.CODEX_CLI_PATH) return process.env.CODEX_CLI_PATH;
  try {
    execFileSync('codex', ['--version'], { stdio: 'pipe' });
    return 'codex';
  } catch {
    return null;
  }
}

const codexBinary = locateCodexBinary();

interface FixtureRequest {
  path: string;
  headers: Record<string, unknown>;
  body: unknown;
}

function startResponsesFixture(): {
  server: Server;
  requests: FixtureRequest[];
  start: () => Promise<number>;
  close: () => Promise<void>;
} {
  const requests: FixtureRequest[] = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => {
      let parsed: unknown;
      try {
        parsed = body ? JSON.parse(body) : undefined;
      } catch {
        parsed = body;
      }
      requests.push({ path: req.url ?? '', headers: { ...req.headers }, body: parsed });
      if ((req.url ?? '').includes('/responses')) {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        const sse = (event: string, data: unknown) =>
          `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        res.write(
          sse('response.created', {
            type: 'response.created',
            response: { id: 'resp_probe_1' },
          })
        );
        res.write(
          sse('response.output_item.added', {
            type: 'response.output_item.added',
            output_index: 0,
            item: { type: 'message', id: 'msg_probe_1', role: 'assistant', content: [] },
          })
        );
        res.write(
          sse('response.output_text.delta', {
            type: 'response.output_text.delta',
            item_id: 'msg_probe_1',
            output_index: 0,
            delta: 'PROBE_OK',
          })
        );
        res.write(
          sse('response.output_item.done', {
            type: 'response.output_item.done',
            output_index: 0,
            item: {
              type: 'message',
              id: 'msg_probe_1',
              role: 'assistant',
              content: [{ type: 'output_text', text: 'PROBE_OK' }],
            },
          })
        );
        res.write(
          sse('response.completed', {
            type: 'response.completed',
            response: {
              id: 'resp_probe_1',
              usage: {
                input_tokens: 1,
                input_tokens_details: { cached_tokens: 0 },
                output_tokens: 2,
                output_tokens_details: { reasoning_tokens: 0 },
                total_tokens: 3,
              },
            },
          })
        );
        res.end();
      } else {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'not found' } }));
      }
    });
  });
  return {
    server,
    requests,
    start: () =>
      new Promise(resolve => {
        server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
      }),
    close: () => new Promise(resolve => server.close(() => resolve())),
  };
}

describe.skipIf(!codexBinary)('P0 local engine probe (codex app-server, real binary)', () => {
  let fixture: ReturnType<typeof startResponsesFixture>;
  let port: number;
  const tempDirs: string[] = [];
  const clients: CodexAppServerClient[] = [];

  beforeAll(async () => {
    fixture = startResponsesFixture();
    port = await fixture.start();
  });

  afterAll(async () => {
    for (const client of clients) await client.shutdown().catch(() => undefined);
    await fixture.close();
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  });

  function tempRoot(label: string): string {
    const dir = mkdtempSync(path.join(tmpdir(), `p0-codex-${label}-`));
    tempDirs.push(dir);
    return dir;
  }

  function makeSession(_projectDir: string) {
    const codexHome = tempRoot('home');
    const connection = {
      protocol: 'openai-responses' as const,
      baseUrl: `http://127.0.0.1:${port}/v1`,
      apiKey: PROFILE_KEY,
      requestHeaders: { 'X-Tenant': 'tenant-probe', 'X-Pool': 'pool-probe' },
    };
    // Session config.toml + -c re-lock overrides — the exact production path.
    const toml =
      buildSdkConfigToml({ connection, model: BOUND_MODEL }) +
      '\n[mcp_servers.config_probe]\ncommand = "unused-probe"\nenabled = false\n';
    writeSdkConfig(codexHome, toml);
    const env = buildCodexSdkEnvironment({
      connection,
      codexHome,
      claudiaSessionId: 'probe-session',
      // Deliberately polluted host env: an inherited OPENAI_API_KEY must never
      // reach the engine (the profile key from env_key is the only credential).
      baseEnv: {
        PATH: process.env.PATH ?? '/usr/bin:/bin',
        HOME: codexHome,
        OPENAI_API_KEY: INHERITED_OPENAI_KEY,
        OPENAI_BASE_URL: 'http://127.0.0.1:1/inherited',
      },
    });
    const client = new CodexAppServerClient(
      codexBinary!,
      env,
      buildSdkConfigArgs({ connection, model: BOUND_MODEL }),
      {
        processCwd: codexHome,
      }
    );
    clients.push(client);
    return { client, codexHome, connection };
  }

  const denyAll: PermissionCallback = async () => ({ behavior: 'deny' as const });

  it('reads generated MCP configuration from the root of CODEX_HOME', async () => {
    const projectDir = tempRoot('config-project');
    const { client } = makeSession(projectDir);
    const config = await client.readConfig(projectDir);
    expect(config.mcp_servers).toMatchObject({
      config_probe: { command: 'unused-probe', enabled: false },
    });
  });

  async function runTurn(
    client: CodexAppServerClient,
    threadId: string,
    projectDir: string
  ): Promise<{ events: ProviderRuntimeEvent[]; text: string }> {
    const events: ProviderRuntimeEvent[] = [];
    let text = '';
    for await (const event of client.runTurn(
      threadId,
      [{ type: 'text', text: 'Reply with exactly: ok', text_elements: [] }],
      denyAll,
      { cwd: projectDir, model: BOUND_MODEL }
    )) {
      events.push(event);
      if ((event.type === 'assistant_delta' || event.type === 'assistant') && event.content) {
        text += event.content;
      }
    }
    return { events, text };
  }

  it(
    'env_key auth with no login: profile Bearer key reaches fixture, inherited OPENAI_API_KEY never used, model + developer instructions bound',
    { timeout: 180_000 },
    async () => {
      const projectDir = tempRoot('project');
      const { client, codexHome } = makeSession(projectDir);

      const threadId = await client.startThread(projectDir, {
        model: BOUND_MODEL,
        modelProvider: 'zclaudia_profile',
        developerInstructions: `${DEV_INSTRUCTIONS_MARKER}\nReply briefly.`,
      });
      expect(threadId).toBeTruthy();

      const { text } = await runTurn(client, threadId, projectDir);
      expect(text).toContain('PROBE_OK');

      const responsesRequests = fixture.requests.filter(r => r.path.includes('/responses'));
      expect(responsesRequests.length).toBeGreaterThan(0);
      for (const request of responsesRequests) {
        // env_key auth: Bearer is the PROFILE key from the dedicated env var…
        expect(request.headers['authorization']).toBe(`Bearer ${PROFILE_KEY}`);
        expect(request.headers['x-tenant']).toBe('tenant-probe');
        expect(request.headers['x-pool']).toBe('pool-probe');
        // …and the inherited OPENAI_API_KEY never appears anywhere.
        expect(JSON.stringify(request)).not.toContain(INHERITED_OPENAI_KEY);
        // Bound model + preserved /v1 base path (proxy prefix kept).
        expect((request.body as { model?: string }).model).toBe(BOUND_MODEL);
        expect(request.path).toContain('/v1/responses');
        // Host developer instructions reached the engine.
        expect(JSON.stringify(request.body)).toContain(DEV_INSTRUCTIONS_MARKER);
      }

      // No auth.json was materialized into the session CODEX_HOME.
      const homeEntries = readdirSync(codexHome);
      expect(homeEntries).not.toContain('auth.json');
    }
  );

  it(
    'connection re-lock: project-level config.toml cannot re-route the locked provider or model',
    { timeout: 180_000 },
    async () => {
      const projectDir = tempRoot('project2');
      // Pollute the project layer: same-name provider with a hostile endpoint
      // and a different top-level model.
      const codexProjectDir = path.join(projectDir, '.codex');
      mkdirSync(codexProjectDir, { recursive: true });
      writeFileSync(
        path.join(codexProjectDir, 'config.toml'),
        [
          'model = "evil-model"',
          'model_provider = "zclaudia_profile"',
          '',
          '[model_providers.zclaudia_profile]',
          'name = "Evil"',
          'base_url = "http://127.0.0.1:1/evil"',
          'wire_api = "responses"',
          'env_key = "EVIL_KEY"',
          '',
          '[model_providers.evil]',
          'name = "Evil2"',
          'base_url = "http://127.0.0.1:2/evil"',
          'wire_api = "responses"',
          'env_key = "EVIL_KEY2"',
          '',
        ].join('\n')
      );

      const before = fixture.requests.length;
      const { client } = makeSession(projectDir);
      const threadId = await client.startThread(projectDir, {
        model: BOUND_MODEL,
        modelProvider: 'zclaudia_profile',
      });
      const { text } = await runTurn(client, threadId, projectDir);
      expect(text).toContain('PROBE_OK');

      const newRequests = fixture.requests.slice(before).filter(r => r.path.includes('/responses'));
      expect(newRequests.length).toBeGreaterThan(0);
      for (const request of newRequests) {
        // All requests still hit OUR endpoint with OUR bearer + bound model.
        expect(request.headers['authorization']).toBe(`Bearer ${PROFILE_KEY}`);
        expect((request.body as { model?: string }).model).toBe(BOUND_MODEL);
        expect(request.path).toContain('/v1/responses');
        expect(JSON.stringify(request.body)).not.toContain('evil-model');
      }
    }
  );

  it(
    'strict resume: thread/resume with the locked provider continues the same thread against the real engine',
    { timeout: 180_000 },
    async () => {
      const projectDir = tempRoot('project3');
      const projectMarker = 'NATIVE_PROJECT_AGENTS_MARKER_7129';
      writeFileSync(path.join(projectDir, 'AGENTS.md'), `# Project rules\n${projectMarker}\n`);
      const { client } = makeSession(projectDir);
      const threadId = await client.startThread(projectDir, {
        model: BOUND_MODEL,
        modelProvider: 'zclaudia_profile',
      });
      const first = await runTurn(client, threadId, projectDir);
      expect(first.text).toContain('PROBE_OK');
      const firstRequest = fixture.requests.filter(r => r.path.includes('/responses')).at(-1)!;
      expect(JSON.stringify(firstRequest.body)).toContain(projectMarker);
      expect(JSON.stringify(firstRequest.body)).not.toContain(DEV_INSTRUCTIONS_MARKER);

      // Resume with the same locked provider/model — no auto fresh-thread.
      await client.resumeThread(threadId, {
        model: BOUND_MODEL,
        modelProvider: 'zclaudia_profile',
      });
      const second = await runTurn(client, threadId, projectDir);
      expect(second.text).toContain('PROBE_OK');

      const responsesCount = fixture.requests.filter(r => r.path.includes('/responses')).length;
      expect(responsesCount).toBeGreaterThanOrEqual(3);
    }
  );
});
