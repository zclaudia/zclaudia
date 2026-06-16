import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

import { createBashBridgeTool, detectSandboxFsDenial } from '../bash-tool.js';
import { runBash } from '../bash-runner.js';
import { __resetSandboxCacheForTests } from '../sandbox.js';

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

    expect(result.content[0].text).toContain('Command: printf hello');
    expect(result.content[0].text).toContain('Status: success');
    expect(result.content[0].text).toContain('Output:');
    expect(result.content[0].text).toContain('hello');
    expect(result.details).toMatchObject({ ok: true, exitCode: 0 });
  });

  it('returns extracted diagnostics for failed compiler-style output', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'zclaudia-bash-module-'));
    const bash = createBashBridgeTool(dir) as any;

    const result = await bash.execute('bash-diagnostics', {
      command: "printf 'src/app.ts:2:7 - error TS2322: Type mismatch\\n' >&2; exit 1",
    });

    await rm(dir, { recursive: true, force: true });
    expect(result.details).toMatchObject({
      ok: false,
      exitCode: 1,
      diagnostics: [
        {
          path: 'src/app.ts',
          line: 2,
          column: 7,
          severity: 'error',
          source: 'TS2322',
          message: 'Type mismatch',
        },
      ],
    });
    expect(result.content[0].text).toContain('Status: failed (Exit code: 1)');
    expect(result.content[0].text).toContain('Diagnostics:');
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

  it('rejects a cwd that resolves to a file instead of a directory', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'zclaudia-bash-module-'));
    await writeFile(path.join(dir, 'file.txt'), 'not a directory\n');
    const bash = createBashBridgeTool(dir) as any;

    const result = await bash.execute('bash-cwd-file', { command: 'pwd', cwd: 'file.txt' });

    await rm(dir, { recursive: true, force: true });
    expect(result.details).toMatchObject({ ok: false, error: 'cwd_not_directory' });
  });

  it('blocks sensitive home file reads even when the sandbox is unavailable', async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), 'zclaudia-bash-module-'));
    const home = await mkdtemp(path.join(tmpdir(), 'zclaudia-home-'));
    const previousHome = process.env.HOME;
    const previousSandbox = process.env.ZCLAUDIA_SANDBOX;
    process.env.HOME = home;
    process.env.ZCLAUDIA_SANDBOX = 'off';
    __resetSandboxCacheForTests();
    await mkdir(path.join(home, '.ssh'));
    await writeFile(path.join(home, '.ssh', 'id_rsa'), 'FAKE_PRIVATE_KEY_FOR_TEST\n');
    const bash = createBashBridgeTool(workspace) as any;

    const result = await bash.execute('bash-sensitive-home', { command: 'cat ~/.ssh/id_rsa' });

    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousSandbox === undefined) delete process.env.ZCLAUDIA_SANDBOX;
    else process.env.ZCLAUDIA_SANDBOX = previousSandbox;
    __resetSandboxCacheForTests();
    await rm(workspace, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
    expect(result.details).toMatchObject({
      ok: false,
      error: 'bash_sensitive_path_blocked',
      path: '~/.ssh/id_rsa',
    });
    expect(result.content[0].text).not.toContain('FAKE_PRIVATE_KEY_FOR_TEST');
  });

  it('blocks pure listing commands and suggests LS', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'zclaudia-bash-module-'));
    await mkdir(path.join(dir, 'src'));
    const bash = createBashBridgeTool(dir) as any;

    const result = await bash.execute('bash-route-ls', { command: 'ls src' });

    await rm(dir, { recursive: true, force: true });
    expect(result.details).toMatchObject({
      ok: false,
      error: 'bash_tool_routing_blocked',
      suggestedTool: 'LS',
      suggestedInput: { path: 'src' },
      kind: 'tool_routing',
    });
  });

  it('blocks pure search commands and suggests Grep', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'zclaudia-bash-module-'));
    await mkdir(path.join(dir, 'src'));
    const bash = createBashBridgeTool(dir) as any;

    const result = await bash.execute('bash-route-rg', { command: 'rg "needle" src' });

    await rm(dir, { recursive: true, force: true });
    expect(result.details).toMatchObject({
      ok: false,
      error: 'bash_tool_routing_blocked',
      suggestedTool: 'Grep',
      suggestedInput: { pattern: 'needle', path: 'src' },
      kind: 'tool_routing',
    });
  });

  it('blocks direct source file reads through shell commands', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'zclaudia-bash-module-'));
    await mkdir(path.join(dir, 'src'));
    await writeFile(path.join(dir, 'src', 'secret.ts'), 'export const secret = "hidden";\n');
    const bash = createBashBridgeTool(dir) as any;

    const result = await bash.execute('bash-read-bypass', { command: 'cat src/secret.ts' });

    await rm(dir, { recursive: true, force: true });
    expect(result.details).toMatchObject({
      ok: false,
      error: 'bash_file_read_blocked',
      suggestedTool: 'Read',
    });
    expect(result.content[0].text).not.toContain('hidden');
  });

  it('blocks direct source file mutations through shell commands', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'zclaudia-bash-module-'));
    await mkdir(path.join(dir, 'src'));
    const filePath = path.join(dir, 'src', 'app.ts');
    await writeFile(filePath, 'export const value = 1;\n');
    const bash = createBashBridgeTool(dir) as any;

    const result = await bash.execute('bash-write-bypass', { command: 'echo "export const value = 2;" > src/app.ts' });
    const onDisk = await readFile(filePath, 'utf8');

    await rm(dir, { recursive: true, force: true });
    expect(result.details).toMatchObject({
      ok: false,
      error: 'bash_file_mutation_blocked',
      suggestedTool: 'Write',
    });
    expect(onDisk).toBe('export const value = 1;\n');
  });

  it('spools large foreground output to a secure log without retaining it all in memory', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'zclaudia-bash-data-'));
    const previousDataDir = process.env.ZCLAUDIA_DATA_DIR;
    process.env.ZCLAUDIA_DATA_DIR = dataDir;

    const result = await runBash({
      command: 'yes x | head -c 200000',
      cwd: dataDir,
      timeoutSec: 30,
      maxBytes: 20_000,
    });
    const fullOutputPath = result.fullOutputPath as string;
    const log = await readFile(fullOutputPath, 'utf8');
    const logStat = await stat(fullOutputPath);

    if (previousDataDir === undefined) delete process.env.ZCLAUDIA_DATA_DIR;
    else process.env.ZCLAUDIA_DATA_DIR = previousDataDir;
    await rm(dataDir, { recursive: true, force: true });
    expect(result.truncated).toBe(true);
    expect(result.fullOutput.length).toBeLessThanOrEqual(20_000);
    expect(fullOutputPath.startsWith(path.join(dataDir, 'bash-logs'))).toBe(true);
    expect((logStat.mode & 0o777)).toBe(0o600);
    expect(log.length).toBe(200000);
  });
});
