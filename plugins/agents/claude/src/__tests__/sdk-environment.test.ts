import { describe, expect, it } from 'vitest';
import { buildClaudeSdkEnvironment } from '../sdk-environment.js';
import { formatCustomHeaders, toClaudeModelConnectionEnv } from '../model-connection.js';
import { RuntimeContractError } from '@zclaudia/plugin-sdk/providers';

const connection = {
  protocol: 'anthropic-messages' as const,
  baseUrl: 'https://proxy.example.com/anthropic',
  apiKey: 'sk-test-key',
  requestHeaders: { 'X-Routing': 'pool-a' },
};

describe('buildClaudeSdkEnvironment', () => {
  it('retains allowlisted host environment when the run only supplies bridge fields', () => {
    const env = buildClaudeSdkEnvironment({
      connection,
      configDirectory: '/data/cfg',
      baseEnv: { ZCLAUDIA_SESSION_ID: 's1' },
    });
    expect(env.PATH).toBe(process.env.PATH);
    expect(env.HOME).toBe(process.env.HOME);
    expect(env.ZCLAUDIA_SESSION_ID).toBe('s1');
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
  });
  it('injects only the explicit connection values', () => {
    const env = buildClaudeSdkEnvironment({
      connection,
      configDirectory: '/data/agent-runtime-state/claude/sdk/s-1',
      model: 'claude-opus-4-8',
      baseEnv: { PATH: '/usr/bin', ZCLAUDIA_SESSION_ID: 's-1' },
    });
    expect(env.ANTHROPIC_API_KEY).toBe('sk-test-key');
    expect(env.ANTHROPIC_BASE_URL).toBe('https://proxy.example.com/anthropic');
    expect(env.ANTHROPIC_CUSTOM_HEADERS).toBe('X-Routing: pool-a');
    expect(env.CLAUDE_CONFIG_DIR).toBe('/data/agent-runtime-state/claude/sdk/s-1');
    // Alias pinning keeps auxiliary requests on the same connection.
    expect(env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe('claude-opus-4-8');
    expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('claude-opus-4-8');
    expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe('claude-opus-4-8');
    expect(env.ZCLAUDIA_SESSION_ID).toBe('s-1');
  });

  it('never inherits auth, base-url, or model-alias variables from the base env', () => {
    const env = buildClaudeSdkEnvironment({
      connection,
      configDirectory: '/data/cfg',
      baseEnv: {
        PATH: '/usr/bin',
        ANTHROPIC_API_KEY: 'sk-inherited',
        ANTHROPIC_AUTH_TOKEN: 'oauth-inherited',
        ANTHROPIC_BASE_URL: 'https://inherited.example.com',
        ANTHROPIC_CUSTOM_HEADERS: 'X-Injected: yes',
        ANTHROPIC_MODEL: 'inherited-model',
        OPENAI_API_KEY: 'sk-openai',
        ANTHROPIC_DEFAULT_HAIKU_MODEL: 'haiku-inherited',
        CLAUDE_CODE_USE_BEDROCK: '1',
        HTTP_PROXY: 'http://proxy:8080',
      },
    });
    expect(env.ANTHROPIC_API_KEY).toBe('sk-test-key');
    expect(env.ANTHROPIC_BASE_URL).toBe('https://proxy.example.com/anthropic');
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(env.ANTHROPIC_CUSTOM_HEADERS).toBe('X-Routing: pool-a');
    expect(env.ANTHROPIC_MODEL).toBeUndefined();
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.CLAUDE_CODE_USE_BEDROCK).toBeUndefined();
    // Proxy config is part of the explicit allowlist.
    expect(env.HTTP_PROXY).toBe('http://proxy:8080');
    // Alias pinning overwrote the inherited alias value.
    expect(env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBeUndefined();
  });

  it('omits alias pinning and headers when not provided', () => {
    const env = buildClaudeSdkEnvironment({
      connection: {
        protocol: 'anthropic-messages',
        baseUrl: 'https://api.anthropic.com',
        apiKey: 'k',
      },
      configDirectory: '/data/cfg',
    });
    expect(env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBeUndefined();
    expect(env.ANTHROPIC_CUSTOM_HEADERS).toBeUndefined();
  });

  it('does not mutate the base env object', () => {
    const baseEnv: Record<string, string> = { PATH: '/usr/bin', ANTHROPIC_API_KEY: 'sk-old' };
    buildClaudeSdkEnvironment({ connection, configDirectory: '/c', baseEnv });
    expect(baseEnv.ANTHROPIC_API_KEY).toBe('sk-old');
    expect(baseEnv.CLAUDE_CONFIG_DIR).toBeUndefined();
  });

  it('rejects non-anthropic protocols', () => {
    expect(() =>
      toClaudeModelConnectionEnv({
        protocol: 'openai-responses',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'k',
      })
    ).toThrow(RuntimeContractError);
  });
});

describe('formatCustomHeaders', () => {
  it('formats header pairs and drops empty values', () => {
    expect(formatCustomHeaders({ A: '1', B: '', C: 'x y' })).toBe('A: 1\nC: x y');
    expect(formatCustomHeaders(undefined)).toBeUndefined();
  });
});
