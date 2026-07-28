import { describe, expect, it } from 'vitest';
import { parseAgentPlaygroundArgs } from '../args.js';

describe('parseAgentPlaygroundArgs', () => {
  it('resolves paths and accepts the runtime and port', () => {
    const parsed = parseAgentPlaygroundArgs(
      [
        '--plugin',
        '../plugins/agents/codex',
        '--runtime',
        'codex',
        '--port',
        '4400',
        '--cwd',
        '../workspace',
        '--token',
        'secret',
        '--no-watch',
      ],
      '/repo/zclaudia'
    );

    expect(parsed).toEqual({
      pluginPath: '/repo/plugins/agents/codex',
      runtime: 'codex',
      port: 4400,
      token: 'secret',
      defaultCwd: '/repo/workspace',
      watch: false,
    });
  });

  it('requires a plugin path', () => {
    expect(() => parseAgentPlaygroundArgs([], '/repo')).toThrow('--plugin is required');
  });

  it('rejects an invalid port', () => {
    expect(() => parseAgentPlaygroundArgs(['--plugin', '/plugin', '--port', '0'], '/repo')).toThrow(
      'Invalid --port'
    );
  });
});
