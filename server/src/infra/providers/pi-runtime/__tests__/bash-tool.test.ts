import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

import { createBashBridgeTool } from '../bash-tool.js';

describe('Bash bridge tool module', () => {
  it('returns a structured success result with exit code 0', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'zclaudia-bash-module-'));
    const bash = createBashBridgeTool(dir) as any;

    const result = await bash.execute('bash-1', { command: 'printf hello' });

    expect(result.content[0].text).toContain('hello');
    expect(result.details).toMatchObject({ ok: true, exitCode: 0 });
  });

  it('errors when the command is empty', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'zclaudia-bash-module-'));
    const bash = createBashBridgeTool(dir) as any;

    const result = await bash.execute('bash-1', { command: '   ' });

    expect(result.details).toMatchObject({ ok: false, error: 'missing_command' });
  });

  it('rejects a cwd outside the workspace', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'zclaudia-bash-module-'));
    await mkdir(path.join(dir, 'sub'));
    const bash = createBashBridgeTool(dir) as any;

    const result = await bash.execute('bash-1', { command: 'pwd', cwd: '..' });

    expect(result.details).toMatchObject({ ok: false, error: 'path_outside_workspace' });
  });
});
