import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PermissionCallback, RuntimeModelConnection } from '@zclaudia/plugin-sdk/providers';
import { RuntimeContractError } from '@zclaudia/plugin-sdk/providers';

const { mockClient, MockCodexAppServerClient } = vi.hoisted(() => {
  const mockClient = {
    currentMode: undefined as string | undefined,
    startThread: vi.fn(async () => 'thread-1'),
    resumeThread: vi.fn(async () => {}),
    runTurn: vi.fn(async function* () {
      yield { type: 'init', sessionId: 'thread-1' };
      yield { type: 'assistant_delta', content: 'ok' };
      yield { type: 'provider_turn_finished', isComplete: true };
    }),
    interruptTurn: vi.fn(async () => {}),
    updateExtraArgs: vi.fn(),
    destroy: vi.fn(),
    shutdown: vi.fn().mockResolvedValue(undefined),
    activeTurns: 0,
    lastActivity: Date.now(),
  };
  return {
    mockClient,
    MockCodexAppServerClient: vi.fn(function MockCodexAppServerClient() {
      return mockClient;
    }),
  };
});

vi.mock('../app-server-client.js', () => ({
  CodexAppServerClient: MockCodexAppServerClient,
}));

import { resetCodexRunnerForTests, runCodexSdkTurn } from '../runner.js';

const denyAll: PermissionCallback = async () => ({ behavior: 'deny' as const });

const connection: RuntimeModelConnection = {
  protocol: 'openai-responses',
  baseUrl: 'https://proxy.example.com/v1',
  apiKey: 'sk-profile-key',
  requestHeaders: { 'X-Pool': 'a' },
};

function sdkOptions(overrides: Record<string, unknown> = {}) {
  return {
    cwd: '/tmp/project',
    cliPath: '/bundled/codex',
    model: 'gpt-5-codex',
    mode: 'default',
    systemPrompt: 'HOST INSTRUCTIONS',
    claudiaSessionId: 'session-1',
    engineExecution: {
      engineMode: 'sdk',
      executableSource: 'bundled-engine',
      configDirectory: tempHome,
    },
    modelConnection: connection,
    ...overrides,
  };
}

let tempHome: string;

describe('runCodexSdkTurn', () => {
  beforeEach(() => {
    resetCodexRunnerForTests();
    MockCodexAppServerClient.mockClear();
    mockClient.startThread.mockClear();
    mockClient.resumeThread.mockClear();
    mockClient.runTurn.mockClear();
    mockClient.shutdown.mockClear();
    mockClient.currentMode = undefined;
    tempHome = mkdtempSync(path.join(tmpdir(), 'codex-sdk-home-'));
  });

  afterEach(() => {
    rmSync(tempHome, { recursive: true, force: true });
  });

  it('fails without the host model-connection contract', async () => {
    const options = sdkOptions({ modelConnection: undefined });
    await expect(async () => {
      for await (const _ of runCodexSdkTurn('hi', options as never, denyAll)) {
        // drain
      }
    }).rejects.toThrow(RuntimeContractError);
  });

  it('fails without the bundled engine path', async () => {
    const options = sdkOptions({ cliPath: undefined });
    await expect(async () => {
      for await (const _ of runCodexSdkTurn('hi', options as never, denyAll)) {
        // drain
      }
    }).rejects.toThrow(/bundled engine path/);
  });

  it('starts a thread with the locked provider, model and developer instructions', async () => {
    for await (const _ of runCodexSdkTurn('hi', sdkOptions(), denyAll)) {
      // drain
    }
    expect(mockClient.startThread).toHaveBeenCalledWith('/tmp/project', {
      model: 'gpt-5-codex',
      modelProvider: 'zclaudia_profile',
      developerInstructions: 'HOST INSTRUCTIONS',
    });
    expect(mockClient.resumeThread).not.toHaveBeenCalled();
    // The turn input must NOT carry the [System Context] prefix in SDK mode.
    const runTurnArgs = mockClient.runTurn.mock.calls[0];
    expect(JSON.stringify(runTurnArgs[1])).not.toContain('System Context');
    // Session-scoped config.toml was written and locks the provider.
    const configPath = path.join(tempHome, 'config.toml');
    expect(existsSync(configPath)).toBe(true);
    const toml = readFileSync(configPath, 'utf8');
    expect(toml).toContain('model_provider = "zclaudia_profile"');
    expect(toml).toContain('env_key = "ZCLAUDIA_CODEX_API_KEY"');
    expect(toml).not.toContain('sk-profile-key');
  });

  it('strictly resumes the existing thread', async () => {
    for await (const _ of runCodexSdkTurn('hi', sdkOptions({ sessionId: 'thread-9' }), denyAll)) {
      // drain
    }
    expect(mockClient.resumeThread).toHaveBeenCalledWith('thread-9', {
      model: 'gpt-5-codex',
      modelProvider: 'zclaudia_profile',
      developerInstructions: 'HOST INSTRUCTIONS',
    });
    expect(mockClient.startThread).not.toHaveBeenCalled();
  });

  it('reports SESSION_RESUME_UNAVAILABLE instead of silently starting a fresh thread', async () => {
    mockClient.resumeThread.mockRejectedValueOnce(new Error('thread not found'));
    const events = [];
    for await (const event of runCodexSdkTurn(
      'hi',
      sdkOptions({ sessionId: 'thread-9' }),
      denyAll
    )) {
      events.push(event);
    }
    expect(mockClient.startThread).not.toHaveBeenCalled();
    const errorEvent = events.find(event => event.type === 'error');
    expect(errorEvent).toMatchObject({ errorCode: 'SESSION_RESUME_UNAVAILABLE' });
  });

  it('restarts the session process when the launch fingerprint changes', async () => {
    for await (const _ of runCodexSdkTurn('hi', sdkOptions(), denyAll)) {
      // drain
    }
    expect(MockCodexAppServerClient).toHaveBeenCalledTimes(1);
    // Connection change (different baseUrl) → shutdown + fresh process.
    for await (const _ of runCodexSdkTurn(
      'hi',
      sdkOptions({
        modelConnection: { ...connection, baseUrl: 'https://other.example.com/v1' },
      }),
      denyAll
    )) {
      // drain
    }
    expect(mockClient.shutdown).toHaveBeenCalled();
    expect(MockCodexAppServerClient).toHaveBeenCalledTimes(2);
  });

  it('rejects non-Responses protocol connections', async () => {
    const options = sdkOptions({
      modelConnection: { ...connection, protocol: 'anthropic-messages' },
    });
    await expect(async () => {
      for await (const _ of runCodexSdkTurn('hi', options as never, denyAll)) {
        // drain
      }
    }).rejects.toThrow(RuntimeContractError);
  });
});
