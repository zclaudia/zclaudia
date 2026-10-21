import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

import { createBashBridgeTool, detectSandboxFsDenial } from '../bash-tool.js';
import { runBash } from '../bash-runner.js';
import { __resetSandboxCacheForTests } from '../sandbox.js';
import { __resetSessionCwdsForTests } from '../bash-session-cwd.js';

// Minimal valid-signature PNG (1x1 pixel); extraction only sniffs magic bytes.
const TINY_PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x62, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

describe('detectSandboxFsDenial', () => {
  it('returns undefined when the command was not sandboxed', () => {
    expect(
      detectSandboxFsDenial('/bin/bash: /tmp/x: Operation not permitted', false, false)
    ).toBeUndefined();
  });

  it('returns undefined when no denial signature is present', () => {
    expect(
      detectSandboxFsDenial('rm: cannot remove: No such file or directory', true, false)
    ).toBeUndefined();
  });

  it('classifies EPERM under a writable sandbox as a write-outside-workspace denial', () => {
    expect(detectSandboxFsDenial('/bin/bash: /tmp/x: Operation not permitted', true, false)).toBe(
      'write_outside_workspace'
    );
  });

  it('classifies EPERM under a read-only sandbox as a read-only denial', () => {
    expect(detectSandboxFsDenial('/bin/bash: /tmp/x: Operation not permitted', true, true)).toBe(
      'read_only'
    );
  });

  it('classifies EROFS as read-only regardless of mode', () => {
    expect(detectSandboxFsDenial('touch: foo: Read-only file system', true, false)).toBe(
      'read_only'
    );
    expect(detectSandboxFsDenial('touch: foo: Read-only file system', true, true)).toBe(
      'read_only'
    );
  });

  it('classifies Node-style lowercase EPERM output as a write denial', () => {
    expect(
      detectSandboxFsDenial(
        "npm error EPERM: operation not permitted, mkdir '/Users/me/.npm/_cacache'",
        true,
        false
      )
    ).toBe('write_outside_workspace');
  });

  it('classifies Node-style EACCES output as a write denial', () => {
    expect(
      detectSandboxFsDenial(
        "npm error EACCES: permission denied, mkdir '/Users/me/.npm/_cacache/content-v2'",
        true,
        false
      )
    ).toBe('write_outside_workspace');
  });

  it('ignores Node-style EACCES output when the command was not sandboxed', () => {
    expect(
      detectSandboxFsDenial("EACCES: permission denied, mkdir '/Users/me/.npm'", false, false)
    ).toBeUndefined();
  });

  it('classifies Node-style EACCES under a read-only sandbox as read-only', () => {
    expect(
      detectSandboxFsDenial("EACCES: permission denied, open '/Users/me/notes.txt'", true, true)
    ).toBe('read_only');
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

  it('lets shell probes of nonexistent files run instead of pointing at Read', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'zclaudia-bash-module-'));
    const bash = createBashBridgeTool(dir) as any;

    const result = await bash.execute('bash-read-missing', {
      command: 'cat missing_output.md 2>/dev/null || echo "NOT FOUND"',
    });

    await rm(dir, { recursive: true, force: true });
    expect(result.details.error).not.toBe('bash_file_read_blocked');
    expect(result.content[0].text).toContain('NOT FOUND');
  });

  it('blocks direct source file mutations through shell commands', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'zclaudia-bash-module-'));
    await mkdir(path.join(dir, 'src'));
    const filePath = path.join(dir, 'src', 'app.ts');
    await writeFile(filePath, 'export const value = 1;\n');
    const bash = createBashBridgeTool(dir) as any;

    const result = await bash.execute('bash-write-bypass', {
      command: 'echo "export const value = 2;" > src/app.ts',
    });
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
    expect(logStat.mode & 0o777).toBe(0o600);
    expect(log.length).toBe(200000);
  });

  it('description discloses that shell control syntax skips tool-routing steering (P2)', () => {
    // Any pipeline/compound command bypasses the LS/Glob/Grep routing guards;
    // the model must be told, or it cannot predict when steering applies.
    const bash = createBashBridgeTool('/tmp');
    expect(bash.description).toContain('shell control syntax');
    expect(bash.description).toMatch(/pipeline|compound/);
    expect(bash.description).toContain('skips that steering');
  });
});

describe('Bash cd persistence and image output', () => {
  let previousSandbox: string | undefined;

  beforeEach(() => {
    // Hermetic: the cd probe runs the same either way, but disabling the
    // sandbox keeps the tests independent of sandbox-exec availability.
    previousSandbox = process.env.ZCLAUDIA_SANDBOX;
    process.env.ZCLAUDIA_SANDBOX = 'off';
    __resetSandboxCacheForTests();
    __resetSessionCwdsForTests();
  });

  afterEach(() => {
    if (previousSandbox === undefined) delete process.env.ZCLAUDIA_SANDBOX;
    else process.env.ZCLAUDIA_SANDBOX = previousSandbox;
    __resetSandboxCacheForTests();
    __resetSessionCwdsForTests();
  });

  describe('cd persistence', () => {
    it('carries a successful cd into the next call and never leaks the probe', async () => {
      const dir = await mkdtemp(path.join(tmpdir(), 'zclaudia-bash-cwd-'));
      await mkdir(path.join(dir, 'sub'));
      const bash = createBashBridgeTool(dir) as any;

      const first = await bash.execute('cd-1', { command: 'cd sub' });
      const second = await bash.execute('cd-2', { command: 'pwd' });

      await rm(dir, { recursive: true, force: true });
      expect(first.details).toMatchObject({ ok: true, exitCode: 0 });
      expect(second.content[0].text).toContain('Cwd: sub');
      expect(second.content[0].text).toContain('/sub');
      expect(second.content[0].text).not.toContain('__ZCLAUDIA_CWD__');
    });

    it('does not update the tracked cwd when the command fails', async () => {
      const dir = await mkdtemp(path.join(tmpdir(), 'zclaudia-bash-cwd-'));
      await mkdir(path.join(dir, 'sub'));
      const bash = createBashBridgeTool(dir) as any;

      await bash.execute('cd-1', { command: 'cd sub' });
      await bash.execute('cd-2', { command: 'cd ..; false' });
      const third = await bash.execute('cd-3', { command: 'pwd' });

      await rm(dir, { recursive: true, force: true });
      expect(third.content[0].text).toContain('Cwd: sub');
    });

    it('resets to the workspace root with a note when a command leaves the workspace', async () => {
      const dir = await mkdtemp(path.join(tmpdir(), 'zclaudia-bash-cwd-'));
      const outside = await mkdtemp(path.join(tmpdir(), 'zclaudia-bash-outside-'));
      const bash = createBashBridgeTool(dir) as any;

      const first = await bash.execute('cd-1', { command: `cd '${outside}'` });
      const second = await bash.execute('cd-2', { command: 'pwd' });

      await rm(dir, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
      expect(first.content[0].text).toContain('Shell cwd was reset to .');
      expect(second.content[0].text).toContain('Cwd: .');
    });

    it('lets an explicit cwd argument win over the tracked session cwd', async () => {
      const dir = await mkdtemp(path.join(tmpdir(), 'zclaudia-bash-cwd-'));
      await mkdir(path.join(dir, 'sub'));
      const bash = createBashBridgeTool(dir) as any;

      await bash.execute('cd-1', { command: 'cd sub' });
      const second = await bash.execute('cd-2', { command: 'pwd', cwd: '.' });

      await rm(dir, { recursive: true, force: true });
      expect(second.content[0].text).toContain('Cwd: .');
    });

    it('shares the tracked cwd across instances with the same sessionId only', async () => {
      const dir = await mkdtemp(path.join(tmpdir(), 'zclaudia-bash-cwd-'));
      await mkdir(path.join(dir, 'sub'));
      const firstInstance = createBashBridgeTool(dir, { sessionId: 'bash-cwd-sess-1' }) as any;
      const secondInstance = createBashBridgeTool(dir, { sessionId: 'bash-cwd-sess-1' }) as any;
      const otherSession = createBashBridgeTool(dir, { sessionId: 'bash-cwd-sess-2' }) as any;

      await firstInstance.execute('cd-1', { command: 'cd sub' });
      const carried = await secondInstance.execute('cd-2', { command: 'pwd' });
      const isolated = await otherSession.execute('cd-3', { command: 'pwd' });

      await rm(dir, { recursive: true, force: true });
      expect(carried.content[0].text).toContain('Cwd: sub');
      expect(isolated.content[0].text).toContain('Cwd: .');
    });

    it('description discloses cd persistence behavior', () => {
      const bash = createBashBridgeTool('/tmp');
      expect(bash.description).toContain('working directory persists across Bash calls');
      expect(bash.description).toContain('resets it to the workspace root');
    });
  });

  describe('image output', () => {
    it('attaches a stdout data URL as an image block for vision models', async () => {
      const dir = await mkdtemp(path.join(tmpdir(), 'zclaudia-bash-img-'));
      await writeFile(path.join(dir, 't.png'), TINY_PNG);
      const bash = createBashBridgeTool(dir, { supportsVision: true }) as any;

      const result = await bash.execute('img-1', {
        command: 'echo "data:image/png;base64,$(base64 < t.png)"',
      });

      await rm(dir, { recursive: true, force: true });
      expect(result.details).toMatchObject({ ok: true });
      expect(result.content).toHaveLength(2);
      expect(result.content[1]).toMatchObject({ type: 'image', mimeType: 'image/png' });
      expect(result.content[1].data).toBe(TINY_PNG.toString('base64'));
      expect(result.details.images[0]).toMatchObject({
        source: 'stdout data URL',
        mimeType: 'image/png',
      });
      expect(result.content[0].text).toContain('attached as an image block below');
      // The echoed Command line contains the literal; the output must not.
      const outputSection = result.content[0].text.slice(
        result.content[0].text.indexOf('\nOutput:\n')
      );
      expect(outputSection).not.toContain(TINY_PNG.toString('base64'));
    });

    it('attaches an iTerm2 inline-image escape as an image block', async () => {
      const dir = await mkdtemp(path.join(tmpdir(), 'zclaudia-bash-img-'));
      const payload = TINY_PNG.toString('base64');
      const command = `printf '%s' $'\\033]1337;File=name=t.png;size=${TINY_PNG.length};inline=1:${payload}\\007'`;
      const bash = createBashBridgeTool(dir, { supportsVision: true }) as any;

      const result = await bash.execute('img-2', { command });

      await rm(dir, { recursive: true, force: true });
      expect(result.content[1]).toMatchObject({ type: 'image', mimeType: 'image/png' });
      expect(result.content[1].data).toBe(payload);
      const outputSection = result.content[0].text.slice(
        result.content[0].text.indexOf('\nOutput:\n')
      );
      expect(outputSection).toContain('[iTerm2 inline image — attached below]');
      expect(outputSection).not.toContain(payload);
    });

    it('attaches an image file whose path the command printed', async () => {
      const dir = await mkdtemp(path.join(tmpdir(), 'zclaudia-bash-img-'));
      await writeFile(path.join(dir, 'out.png'), TINY_PNG);
      const bash = createBashBridgeTool(dir, { supportsVision: true }) as any;

      const result = await bash.execute('img-3', { command: 'echo "saved to out.png"' });

      await rm(dir, { recursive: true, force: true });
      expect(result.content[1]).toMatchObject({ type: 'image', mimeType: 'image/png' });
      expect(result.content[1].data).toBe(TINY_PNG.toString('base64'));
      expect(result.details.images[0].source).toBe(path.join(dir, 'out.png'));
    });

    it('returns text-only content when the model has no vision', async () => {
      const dir = await mkdtemp(path.join(tmpdir(), 'zclaudia-bash-img-'));
      const bash = createBashBridgeTool(dir) as any;

      const result = await bash.execute('img-4', {
        command: `printf '%s' 'data:image/png;base64,${TINY_PNG.toString('base64')}'`,
      });

      await rm(dir, { recursive: true, force: true });
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      expect(result.content[0].text).toContain('no vision');
    });
  });
});
