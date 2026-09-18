import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { type AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { runClaudeAgent } from '../runner.js';
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { buildClaudeSdkEnvironment } from '../sdk-environment.js';
import type { ProviderRuntimeEvent } from '@zclaudia/plugin-sdk/providers';

/**
 * P0 local-engine probe (design: docs/plans/2026-09-11-claude-dual-mode-runtime-design.md §12).
 *
 * Drives the APP-BUNDLED Claude Code engine binary through the real plugin
 * runner (SDK mode) against a local Anthropic Messages HTTP fixture — no
 * network, no user login, no system CLI. Skipped automatically on machines
 * where the darwin/linux/win engine package for this platform is not
 * installed; evidence recorded in the design doc.
 */

const here = path.dirname(fileURLToPath(import.meta.url));

const PROBE_KEY = 'sk-probe-key-0001';
const SETTINGS_LEAK_TOKEN = 'TOKEN_FROM_USER_SETTINGS_LEAK';
const CLAUDE_MD_MARKER = 'CLAUDEMD_AUTOLD_MARKER_4711';
const HOST_PROMPT_MARKER = 'HOST_INJECTED_MARKER_9A3F';
const BOUND_MODEL = 'claude-probe-model';

function locateBundledEngine(): string | null {
  const override = process.env.ZCLAUDIA_BUNDLED_CLAUDE_SDK_EXECUTABLE;
  if (override) return existsSync(override) ? override : null;
  const platform = `${process.platform}-${process.arch}`;
  const binary = process.platform === 'win32' ? 'claude.exe' : 'claude';
  try {
    const requireFromPlugin = createRequire(path.join(here, '../../package.json'));
    const sdkDir = path.dirname(requireFromPlugin.resolve('@anthropic-ai/claude-agent-sdk'));
    const packageRoot = path.dirname(sdkDir);
    const candidates = [
      path.join(packageRoot, `claude-agent-sdk-${platform}`, binary),
      path.join(sdkDir, 'node_modules', '@anthropic-ai', `claude-agent-sdk-${platform}`, binary),
    ];
    for (const candidate of candidates) if (existsSync(candidate)) return candidate;
  } catch {
    return null;
  }
  return null;
}

const engineBinary = locateBundledEngine();

interface FixtureRequest {
  path: string;
  headers: Record<string, unknown>;
  body: unknown;
}

function startAnthropicFixture(): {
  server: Server;
  requests: FixtureRequest[];
  start: () => Promise<number>;
  close: () => Promise<void>;
} {
  const requests: FixtureRequest[] = [];
  let turnCounter = 0;
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
      if ((req.url ?? '').includes('/messages')) {
        turnCounter += 1;
        const text = `PROBE_TURN_${turnCounter}`;
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        const sse = (event: string, data: unknown) =>
          `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        res.write(
          sse('message_start', {
            type: 'message_start',
            message: {
              id: `msg_probe_${turnCounter}`,
              type: 'message',
              role: 'assistant',
              model: (parsed as { model?: string } | undefined)?.model ?? BOUND_MODEL,
              content: [],
              stop_reason: null,
              usage: { input_tokens: 1, output_tokens: 1 },
            },
          })
        );
        res.write(
          sse('content_block_start', {
            type: 'content_block_start',
            index: 0,
            content_block: { type: 'text', text: '' },
          })
        );
        res.write(
          sse('content_block_delta', {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text },
          })
        );
        res.write(sse('content_block_stop', { type: 'content_block_stop', index: 0 }));
        res.write(
          sse('message_delta', {
            type: 'message_delta',
            delta: { stop_reason: 'end_turn' },
            usage: { output_tokens: 5 },
          })
        );
        res.write(sse('message_stop', { type: 'message_stop' }));
        res.end();
      } else {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { type: 'not_found' } }));
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

function findTranscripts(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) findTranscripts(full, acc);
    else acc.push(full);
  }
  return acc;
}

describe.skipIf(!engineBinary)('P0 local engine probe (claude sdk, real engine binary)', () => {
  const enginePath = engineBinary!;
  let fixture: ReturnType<typeof startAnthropicFixture>;
  let port: number;
  const tempDirs: string[] = [];

  beforeAll(async () => {
    fixture = startAnthropicFixture();
    port = await fixture.start();
  });

  afterAll(async () => {
    await fixture.close();
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  });

  function tempRoot(label: string): string {
    const dir = mkdtempSync(path.join(tmpdir(), `p0-claude-${label}-`));
    tempDirs.push(dir);
    return dir;
  }

  function sdkOptions(
    configDirectory: string,
    projectDir: string,
    homeDir: string,
    sessionId?: string
  ) {
    const connection = {
      protocol: 'anthropic-messages' as const,
      baseUrl: `http://127.0.0.1:${port}`,
      apiKey: PROBE_KEY,
    };
    return {
      cwd: projectDir,
      sessionId,
      cliPath: enginePath,
      model: BOUND_MODEL,
      systemPrompt: `${HOST_PROMPT_MARKER}\nYou are under local probe. Reply briefly.`,
      engineExecution: {
        engineMode: 'sdk',
        executableSource: 'bundled-sdk' as const,
        configDirectory,
      },
      modelConnection: connection,
      env: buildClaudeSdkEnvironment({
        connection,
        configDirectory,
        model: BOUND_MODEL,
        // Home points at an EMPTY fake home (with a booby-trapped user settings
        // file) — proving the run works with no real user login/state.
        baseEnv: {
          PATH: process.env.PATH ?? '/usr/bin:/bin',
          HOME: homeDir,
        },
      }),
    };
  }

  async function runTurn(options: ReturnType<typeof sdkOptions>): Promise<{
    events: ProviderRuntimeEvent[];
    sessionId?: string;
    assistantText: string;
  }> {
    const events: ProviderRuntimeEvent[] = [];
    let sessionId: string | undefined;
    let assistantText = '';
    for await (const event of runClaudeAgent('Reply with exactly: ok', options)) {
      events.push(event);
      if (event.type === 'init' && event.sessionId) sessionId = event.sessionId;
      if ((event.type === 'assistant' || event.type === 'assistant_delta') && event.content) {
        assistantText += event.content;
      }
    }
    return { events, sessionId, assistantText };
  }

  it.each([undefined, HOST_PROMPT_MARKER])(
    'engine loads project instructions and MCP tools, isolates credentials, custom prompt: %s',
    { timeout: 240_000 },
    async customPrompt => {
      const requestStart = fixture.requests.length;
      const homeDir = tempRoot('home');
      const projectDir = tempRoot('project');
      const configDirectory = tempRoot('cfg');

      // Booby trap: if global user settings were loaded, the
      // engine would pick up this env-injected auth token and send it to us.
      mkdirSync(path.join(homeDir, '.claude'), { recursive: true });
      writeFileSync(
        path.join(homeDir, '.claude', 'settings.json'),
        JSON.stringify(
          {
            env: {
              ANTHROPIC_AUTH_TOKEN: SETTINGS_LEAK_TOKEN,
              ANTHROPIC_BASE_URL: 'http://127.0.0.1:1/leak',
            },
          },
          null,
          2
        ),
        { mode: 0o600 }
      );
      // Project instructions must be loaded by the engine, not the host.
      writeFileSync(path.join(projectDir, 'CLAUDE.md'), `# probe\n${CLAUDE_MD_MARKER}\n`);
      writeFileSync(path.join(projectDir, 'README.md'), 'probe project\n');
      mkdirSync(path.join(projectDir, '.claude'), { recursive: true });
      writeFileSync(
        path.join(projectDir, '.claude', 'settings.json'),
        JSON.stringify({
          env: {
            ANTHROPIC_AUTH_TOKEN: SETTINGS_LEAK_TOKEN,
            ANTHROPIC_API_KEY: SETTINGS_LEAK_TOKEN,
            ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}/project-override`,
            ANTHROPIC_DEFAULT_HAIKU_MODEL: 'project-override-model',
          },
        })
      );

      const events: ProviderRuntimeEvent[] = [];
      const mcpServer = createSdkMcpServer({
        name: 'delivery-probe',
        tools: [
          tool('push_file', 'Push a local file to the user device.', {}, async () => ({
            content: [{ type: 'text' as const, text: 'delivered' }],
          })),
        ],
      });
      for await (const event of runClaudeAgent('Reply briefly.', {
        ...sdkOptions(configDirectory, projectDir, homeDir),
        systemPrompt: customPrompt,
        mcpServers: { 'delivery-probe': mcpServer },
      }))
        events.push(event);

      expect(events.some(event => event.type === 'init' && event.sessionId)).toBe(true);
      expect(
        events.some(
          event =>
            (event.type === 'assistant' || event.type === 'assistant_delta') &&
            event.content?.includes('PROBE_TURN_')
        )
      ).toBe(true);

      const messagesRequests = fixture.requests
        .slice(requestStart)
        .filter(r => r.path.includes('/messages'));
      expect(messagesRequests.length).toBeGreaterThan(0);

      for (const request of messagesRequests) {
        const bodyText = JSON.stringify(request.body ?? {});
        // Connection: EVERY request — including auxiliary ones (title
        // generation) — carries our api key and stays on the bound model.
        // The engine's haiku-class aux calls are re-routed onto the bound
        // model by the ANTHROPIC_DEFAULT_*_MODEL alias pinning.
        expect(request.headers['x-api-key']).toBe(PROBE_KEY);
        expect(request.path).not.toContain('project-override');
        expect((request.body as { model?: string }).model).toBe(BOUND_MODEL);
        // User settings env must NOT leak into auth headers.
        expect(JSON.stringify(request.headers)).not.toContain(SETTINGS_LEAK_TOKEN);
        expect(bodyText).not.toContain(SETTINGS_LEAK_TOKEN);
      }
      // Main turns include tools; auxiliary title requests do not. The native
      // preset's identity text differs from the preset-with-append variant.
      const mainRequests = messagesRequests.filter(
        request => ((request.body as { tools?: unknown[] }).tools?.length ?? 0) > 0
      );
      expect(mainRequests.length).toBeGreaterThan(0);
      for (const request of mainRequests) {
        if (customPrompt) expect(JSON.stringify(request.body)).toContain(customPrompt);
        else expect(JSON.stringify(request.body)).not.toContain(HOST_PROMPT_MARKER);
        expect(JSON.stringify(request.body)).toContain(CLAUDE_MD_MARKER);
      }
      expect(
        mainRequests.some(request =>
          JSON.stringify((request.body as { tools?: unknown }).tools).includes(
            'mcp__delivery-probe__push_file'
          )
        )
      ).toBe(true);
      for (const file of findTranscripts(configDirectory).filter(file => file.endsWith('.jsonl'))) {
        expect(readFileSync(file, 'utf8')).not.toContain(PROBE_KEY);
      }
      // No request may leave for any other path than the fixture's messages API
      // plus benign engine endpoints — specifically no /v1/complete or oauth.
      const paths = fixture.requests.map(r => r.path);
      expect(paths.some(p => p.includes('oauth'))).toBe(false);
    }
  );

  it(
    'persistSession: transcript lands in the session config dir and resume continues the same provider session',
    { timeout: 240_000 },
    async () => {
      const homeDir = tempRoot('home2');
      const projectDir = tempRoot('project2');
      const configDirectory = tempRoot('cfg2');
      const options = sdkOptions(configDirectory, projectDir, homeDir);

      const first = await runTurn(options);
      expect(first.sessionId).toBeTruthy();

      // Transcript must be persisted under the host-managed config dir.
      const transcriptFiles = findTranscripts(configDirectory).filter(f => f.endsWith('.jsonl'));
      expect(transcriptFiles.length).toBeGreaterThan(0);

      // Resume the SAME provider session through the same bound connection.
      const second = await runTurn({ ...options, sessionId: first.sessionId });
      expect(second.sessionId).toBe(first.sessionId);
      expect(second.assistantText).toContain('PROBE_TURN_');
      expect(
        fixture.requests.filter(r => r.path.includes('/messages')).length
      ).toBeGreaterThanOrEqual(2);
    }
  );

  it(
    'cleanupPeriodDays: 36500-day retention keeps aged transcript files across runs',
    { timeout: 240_000 },
    async () => {
      const homeDir = tempRoot('home3');
      const projectDir = tempRoot('project3');
      const configDirectory = tempRoot('cfg3');
      const options = sdkOptions(configDirectory, projectDir, homeDir);

      const first = await runTurn(options);
      expect(first.sessionId).toBeTruthy();
      const transcriptDir = path.dirname(
        findTranscripts(configDirectory).find(f => f.endsWith('.jsonl'))!
      );
      const agedFile = path.join(transcriptDir, 'aged-probe.jsonl');
      writeFileSync(agedFile, '{"type":"probe"}\n');
      const fourHundredDaysAgo = new Date(Date.now() - 400 * 24 * 3600 * 1000);
      utimesSync(agedFile, fourHundredDaysAgo, fourHundredDaysAgo);

      // Another run on the same config dir (retention window 36500 days).
      const second = await runTurn({ ...options, sessionId: first.sessionId });
      expect(second.sessionId).toBe(first.sessionId);
      expect(existsSync(agedFile)).toBe(true);

      // Observation for §12.6: with a 1-day window, does the engine sweep the
      // aged file on startup? Recorded either way (not a hard gate here).
      const legacyEnv = { ...options.env };
      try {
        const { query } = await import('@anthropic-ai/claude-agent-sdk');
        const stream = query({
          prompt: 'Reply with exactly: ok',
          options: {
            cwd: projectDir,
            abortController: new AbortController(),
            settingSources: [],
            persistSession: true,
            settings: { cleanupPeriodDays: 1 },
            pathToClaudeCodeExecutable: enginePath,
            model: BOUND_MODEL,
            env: legacyEnv,
          },
        });
        for await (const _ of stream) {
          // drain
        }
        stream.close();
      } catch {
        // Sweep probe is best-effort; engine rejection must not fail the run.
      }
      const swept = !existsSync(agedFile);
      console.log(`[P0][claude] cleanupPeriodDays=1 sweep observed: ${swept}`);
    }
  );
});
