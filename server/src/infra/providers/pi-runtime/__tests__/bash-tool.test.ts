import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

import { createBashBridgeTool, detectSandboxFsDenial } from '../bash-tool.js';

describe('detectSandboxFsDenial', () => {
  it('returns undefined when the command was not sandboxed', () => {
    expect(detectSandboxFsDenial('/bin/bash: /tmp/x: Operation not permitted', false, false)).toBeUndefined();
  });

  it('returns undefined when no denial signature is present', () => {
    expect(detectSandboxFsDenial('rm: cannot remove: No such file or directory', true, false)).toBeUndefined();
  });

  it('classifies EPERM under a writable sandbox as a write-outside-workspace denial', () => {
    expect(detectSandboxFsDenial('/bin/bash: /tmp/x: Operation not permitted', true, false))
      .toBe('write_outside_workspace');
  });

  it('classifies EPERM under a read-only sandbox as a read-only denial', () => {
    expect(detectSandboxFsDenial('/bin/bash: /tmp/x: Operation not permitted', true, true))
      .toBe('read_only');
  });

  it('classifies EROFS as read-only regardless of mode', () => {
    expect(detectSandboxFsDenial('touch: foo: Read-only file system', true, false)).toBe('read_only');
    expect(detectSandboxFsDenial('touch: foo: Read-only file system', true, true)).toBe('read_only');
  });
});

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
