import { describe, it, expect, afterEach } from 'vitest';
import {
  ENV_PASSTHROUGH_KNOB,
  isSecretEnvName,
  scrubEnv,
} from '../env-scrub.js';

describe('isSecretEnvName', () => {
  it('flags secret-looking names', () => {
    const secrets = [
      'ANTHROPIC_API_KEY',
      'OPENAI_API_KEY',
      'AWS_SECRET_ACCESS_KEY',
      'AWS_SESSION_TOKEN',
      'GITHUB_TOKEN',
      'GH_TOKEN',
      'NPM_TOKEN',
      'MY_APP_PASSWORD',
      'DB_PASSWD',
      'OAUTH_TOKEN',
      'SERVICE_PRIVATE_KEY',
      'STRIPE_SECRET',
      'KUBE_CREDENTIALS',
    ];
    for (const name of secrets) {
      expect(isSecretEnvName(name), name).toBe(true);
    }
  });

  it('keeps base workflow vars (including names that trip the pattern)', () => {
    const safe = [
      'PATH',
      'HOME',
      'LANG',
      'LC_ALL',
      'TERM',
      'SHELL',
      'USER',
      'LOGNAME',
      'TMPDIR',
      'TMP',
      'TEMP',
      'XDG_CONFIG_HOME',
      'http_proxy',
      'https_proxy',
      'no_proxy',
      'HTTP_PROXY',
      'HTTPS_PROXY',
      'NO_PROXY',
      'SSH_AUTH_SOCK', // matches the AUTH pattern but explicitly allowlisted
      'DISPLAY',
      'ZCLAUDIA_DATA_DIR',
      'npm_config_cache',
      'EDITOR',
    ];
    for (const name of safe) {
      expect(isSecretEnvName(name), name).toBe(false);
    }
  });
});

describe('scrubEnv', () => {
  afterEach(() => {
    delete process.env[ENV_PASSTHROUGH_KNOB];
  });

  it('drops secret-looking vars and keeps the rest', () => {
    const out = scrubEnv({
      PATH: '/usr/bin',
      HOME: '/home/u',
      ANTHROPIC_API_KEY: 'sk-ant',
      MY_CUSTOM_TOKEN: 'tok',
      npm_config_cache: '/cache',
    });
    expect(out.PATH).toBe('/usr/bin');
    expect(out.HOME).toBe('/home/u');
    expect(out.npm_config_cache).toBe('/cache');
    expect(out.ANTHROPIC_API_KEY).toBeUndefined();
    expect(out.MY_CUSTOM_TOKEN).toBeUndefined();
  });

  it('does not mutate the input environment', () => {
    const input = { PATH: '/usr/bin', SECRET_KEY: 'x' };
    scrubEnv(input);
    expect(input.SECRET_KEY).toBe('x');
  });

  it('extraEnv always wins, even for secret-looking names (explicit opt-in)', () => {
    const out = scrubEnv({ PATH: '/usr/bin' }, { ZC_TEST_API_KEY: 'explicit', HOOK_VAR: '1' });
    expect(out.ZC_TEST_API_KEY).toBe('explicit');
    expect(out.HOOK_VAR).toBe('1');
  });

  it('honors the ZCLAUDIA_BASH_ENV_PASSTHROUGH operator escape hatch', () => {
    process.env[ENV_PASSTHROUGH_KNOB] = 'ZC_TEST_TOKEN, ANOTHER_SECRET ';
    const out = scrubEnv({
      PATH: '/usr/bin',
      ZC_TEST_TOKEN: 'keep-me',
      ANOTHER_SECRET: 'keep-me-too',
      UNLISTED_SECRET: 'drop-me',
    });
    expect(out.ZC_TEST_TOKEN).toBe('keep-me');
    expect(out.ANOTHER_SECRET).toBe('keep-me-too');
    expect(out.UNLISTED_SECRET).toBeUndefined();
  });
});
