import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'fs/promises';
import { readFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { buildTools } from '../tool-bridge.js';

let base: string;
let primary: string;
let extra: string;
let third: string;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let tools: Record<string, any>;

function text(result: { content: Array<{ text?: string }> }): string {
  return result.content.map(c => c.text ?? '').join('');
}

beforeAll(async () => {
  base = await realpath(await mkdtemp(path.join(tmpdir(), 'zc-addl-tools-')));
  primary = path.join(base, 'proj');
  extra = path.join(base, 'extra');
  third = path.join(base, 'third');
  for (const d of [primary, extra, third]) await mkdir(d);
  await writeFile(path.join(extra, 'notes.txt'), 'alpha needle\nbeta\n');
  await writeFile(path.join(third, 'secret.txt'), 'top secret\n');
  await symlink(third, path.join(extra, 'escape'));
  const built = buildTools(primary, {
    enabled: ['Read', 'Write', 'Edit', 'Grep', 'Glob', 'LS', 'Bash', 'LSPTool'],
    additionalRoots: [extra],
  });
  tools = Object.fromEntries(built.map(t => [t.name, t]));
});
afterAll(() => rm(base, { recursive: true, force: true }));

describe('Pi tools with an additional directory', () => {
  it('Write creates a file in the additional directory', async () => {
    const target = path.join(extra, 'sub', 'new.txt');
    const result = await tools.Write.execute('w1', { file_path: target, content: 'hello\n' });
    expect(result.details).not.toMatchObject({ ok: false });
    expect(await readFile(target, 'utf8')).toBe('hello\n');
  });

  it('Read then Edit work on a file in the additional directory', async () => {
    const target = path.join(extra, 'notes.txt');
    const read = await tools.Read.execute('r1', { path: target });
    expect(text(read)).toContain('alpha needle');
    const edit = await tools.Edit.execute('e1', {
      file_path: target,
      old_string: 'beta',
      new_string: 'gamma',
    });
    expect(edit.details).not.toMatchObject({ ok: false });
    expect(readFileSync(target, 'utf8')).toContain('gamma');
  });

  it('refuses a third directory', async () => {
    const result = await tools.Write.execute('w2', {
      file_path: path.join(third, 'x.txt'),
      content: 'no',
    });
    expect(result.details).toMatchObject({ ok: false, error: 'path_outside_workspace' });
    const read = await tools.Read.execute('r2', { path: path.join(third, 'secret.txt') });
    expect(read.details).toMatchObject({ ok: false, error: 'path_outside_workspace' });
  });

  it('refuses a symlink in the additional directory that leads out of it', async () => {
    const result = await tools.Write.execute('w3', {
      file_path: path.join(extra, 'escape', 'x.txt'),
      content: 'no',
    });
    expect(result.details).toMatchObject({ ok: false, error: 'path_outside_workspace' });
  });

  it('Grep, Glob and LS accept an additional directory path', async () => {
    const grep = await tools.Grep.execute('g1', { pattern: 'needle', path: extra });
    expect(text(grep)).toContain('notes.txt');
    const glob = await tools.Glob.execute('g2', { pattern: '*.txt', path: extra });
    expect(text(glob)).toContain('notes.txt');
    const ls = await tools.LS.execute('l1', { path: extra });
    expect(text(ls)).toContain('notes.txt');
    const denied = await tools.LS.execute('l2', { path: third });
    expect(denied.details).toMatchObject({ ok: false });
  });

  it('Bash may use an additional directory as its cwd, but not a third one', async () => {
    const ok = await tools.Bash.execute('b1', { command: 'pwd', cwd: extra });
    expect(text(ok)).toContain(extra);
    const denied = await tools.Bash.execute('b2', { command: 'pwd', cwd: third });
    expect(denied.details).toMatchObject({ ok: false });
  });

  it('LSPTool explains that additional directories have no language server', async () => {
    if (!tools.LSPTool) return; // only registered when a language server exists
    const result = await tools.LSPTool.execute('s1', {
      action: 'diagnostics',
      file: path.join(extra, 'notes.txt'),
    });
    expect(text(result)).toMatch(/additional directory|primary workspace/);
  });
});
