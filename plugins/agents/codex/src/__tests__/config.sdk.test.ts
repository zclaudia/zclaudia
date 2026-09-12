import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RuntimeModelConnection } from '@zclaudia/plugin-sdk/providers';
import { RuntimeContractError } from '@zclaudia/plugin-sdk/providers';
import {
  buildCodexSdkEnvironment,
  buildSdkConfigArgs,
  buildSdkConfigToml,
  CODEX_SDK_API_KEY_ENV,
  CODEX_SDK_PROVIDER_ID,
  resetSdkConfigWriteCacheForTests,
  sdkHeaderEnvVarNames,
  writeSdkConfig,
} from '../config.js';

const connection: RuntimeModelConnection = {
  protocol: 'openai-responses',
  baseUrl: 'https://proxy.example.com/openai/v1',
  apiKey: 'sk-profile-key',
  requestHeaders: { 'X-Pool': 'a', 'X-Tenant': 't1' },
};

describe('buildCodexSdkEnvironment', () => {
  it('retains allowlisted host environment with a bridge-only run overlay', () => {
    const env = buildCodexSdkEnvironment({
      connection,
      codexHome: '/data/cfg',
      baseEnv: { ZCLAUDIA_SESSION_ID: 's1' },
    });
    expect(env.PATH).toBe(process.env.PATH);
    expect(env.HOME).toBe(process.env.HOME);
    expect(env.ZCLAUDIA_SESSION_ID).toBe('s1');
    expect(env.OPENAI_API_KEY).toBeUndefined();
  });
  it('builds the env from an allowlist and injects the connection', () => {
    const env = buildCodexSdkEnvironment({
      connection,
      codexHome: '/data/agent-runtime-state/codex/sdk/s-1',
      claudiaSessionId: 's-1',
      baseEnv: { PATH: '/usr/bin', HOME: '/home/u' },
    });
    expect(env.CODEX_HOME).toBe('/data/agent-runtime-state/codex/sdk/s-1');
    expect(env[CODEX_SDK_API_KEY_ENV]).toBe('sk-profile-key');
    expect(env.ZCLAUDIA_SESSION_ID).toBe('s-1');
    // Header values live in dedicated env vars, referenced by name from TOML.
    expect(env.ZCLAUDIA_CODEX_HEADER_X_POOL).toBe('a');
    expect(env.ZCLAUDIA_CODEX_HEADER_X_TENANT).toBe('t1');
  });

  it('never inherits Codex/OpenAI auth or endpoint variables', () => {
    const env = buildCodexSdkEnvironment({
      connection,
      codexHome: '/h',
      baseEnv: {
        PATH: '/usr/bin',
        OPENAI_API_KEY: 'sk-inherited',
        CODEX_API_KEY: 'codex-inherited',
        OPENAI_BASE_URL: 'https://inherited.example.com/v1',
        CODEX_HOME: '/inherited-codex-home',
        ANTHROPIC_API_KEY: 'sk-anthropic',
        HTTPS_PROXY: 'http://proxy:8080',
      },
    });
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.CODEX_API_KEY).toBeUndefined();
    expect(env.OPENAI_BASE_URL).toBeUndefined();
    expect(env.CODEX_HOME).toBe('/h');
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    // Proxy config is allowlisted.
    expect(env.HTTPS_PROXY).toBe('http://proxy:8080');
  });

  it('rejects non-Responses protocols', () => {
    expect(() =>
      buildCodexSdkEnvironment({
        connection: { ...connection, protocol: 'anthropic-messages' },
        codexHome: '/h',
      })
    ).toThrow(RuntimeContractError);
  });

  it('rejects connections without an API key', () => {
    expect(() =>
      buildCodexSdkEnvironment({ connection: { ...connection, apiKey: ' ' }, codexHome: '/h' })
    ).toThrow(RuntimeContractError);
  });

  it('maps header names to safe env var names only', () => {
    expect(sdkHeaderEnvVarNames(connection)).toEqual([
      'ZCLAUDIA_CODEX_HEADER_X_POOL',
      'ZCLAUDIA_CODEX_HEADER_X_TENANT',
    ]);
  });
});

describe('SDK config generation', () => {
  it('generates a dedicated provider TOML without any secret material', () => {
    const toml = buildSdkConfigToml({ connection, model: 'gpt-5-codex' });
    expect(toml).toContain(`[model_providers.${CODEX_SDK_PROVIDER_ID}]`);
    expect(toml).toContain('wire_api = "responses"');
    expect(toml).toContain('base_url = "https://proxy.example.com/openai/v1"');
    expect(toml).toContain(
      'env_http_headers = { "X-Pool" = "ZCLAUDIA_CODEX_HEADER_X_POOL", "X-Tenant" = "ZCLAUDIA_CODEX_HEADER_X_TENANT" }'
    );
    expect(toml).not.toContain('sk-profile-key');
    expect(toml).not.toContain('Authorization');
  });

  it('generates -c overrides that re-lock provider and model as TOML values', () => {
    const args = buildSdkConfigArgs({ connection, model: 'gpt-5-codex' });
    const joined = args.join(' ');
    expect(joined).toContain('model_provider="zclaudia_profile"');
    expect(joined).toContain('model="gpt-5-codex"');
    expect(joined).toContain('model_providers.zclaudia_profile.base_url=');
    expect(joined).not.toContain('sk-profile-key');
  });
});

describe('writeSdkConfig', () => {
  beforeEach(() => {
    resetSdkConfigWriteCacheForTests();
  });

  it('writes atomically into the session CODEX_HOME and skips redundant writes', () => {
    const home = mkdtempSync(path.join(tmpdir(), 'codex-sdk-write-'));
    try {
      const toml = buildSdkConfigToml({ connection, model: 'm1' });
      writeSdkConfig(home, toml);
      const configPath = path.join(home, 'config.toml');
      expect(readFileSync(configPath, 'utf8')).toBe(toml);
      // Redundant write is skipped (cache hit), changed content rewrites.
      writeSdkConfig(home, toml);
      writeSdkConfig(home, `${toml}\n# changed\n`);
      expect(readFileSync(configPath, 'utf8')).toBe(`${toml}\n# changed\n`);
      // No temp leftovers.
      expect(existsSync(`${configPath}.tmp-${process.pid}`)).toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
