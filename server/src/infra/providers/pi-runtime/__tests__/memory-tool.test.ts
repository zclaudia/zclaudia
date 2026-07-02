import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createMemoryTool } from '../memory-tool.js';
import type { MemoryProvider } from '../memory-provider.js';

let memoryDir: string;
let tool: ReturnType<typeof createMemoryTool>;

function run(params: Record<string, unknown>) {
  return (tool as any).execute('tc-1', params);
}

/** Extract the text content from a tool result */
function text(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('\n');
}

beforeEach(() => {
  memoryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zclaudia-memory-test-'));
  tool = createMemoryTool({ memoryDir });
});

afterEach(() => {
  fs.rmSync(memoryDir, { recursive: true, force: true });
});

describe('Memory tool', () => {
  it('create writes a file and mkdirs parents', async () => {
    await run({ command: 'create', path: '/memories/notes/a.md', file_text: 'hello' });
    expect(fs.readFileSync(path.join(memoryDir, 'notes/a.md'), 'utf8')).toBe('hello');
  });

  it('can run against an injected memory provider', async () => {
    const calls: string[] = [];
    const provider: MemoryProvider = {
      async read(target) {
        calls.push(`read:${target.path}`);
        return { ok: true, kind: 'file', text: '1\tfrom provider' };
      },
      async list(target) {
        calls.push(`list:${target.path}`);
        return { ok: true, kind: 'directory', text: '/memories/from-provider.md (13 bytes)' };
      },
      async create(target, content) {
        calls.push(`create:${target.path}:${content}`);
        return { ok: true };
      },
      async replace() {
        return { ok: true };
      },
      async insert() {
        return { ok: true };
      },
      async delete() {
        return { ok: true };
      },
      async rename() {
        return { ok: true };
      },
    };
    const injected = createMemoryTool({ provider }) as any;

    const viewed = await injected.execute('tc-provider', {
      command: 'view',
      path: '/memories/from-provider.md',
    });
    await injected.execute('tc-provider', {
      command: 'create',
      path: '/memories/new.md',
      file_text: 'remember this',
    });

    expect(text(viewed)).toContain('from provider');
    expect(calls).toEqual([
      'read:/memories/from-provider.md',
      'create:/memories/new.md:remember this',
    ]);
  });

  it('create refuses to overwrite an existing memory', async () => {
    await run({ command: 'create', path: '/memories/a.md', file_text: 'first' });
    const result = await run({ command: 'create', path: '/memories/a.md', file_text: 'second' });
    expect((result.details as any).error).toBe('already_exists');
    expect(fs.readFileSync(path.join(memoryDir, 'a.md'), 'utf8')).toBe('first');
  });

  it('view on directory lists files; on file shows numbered lines', async () => {
    await run({ command: 'create', path: '/memories/a.md', file_text: 'line1\nline2' });
    const listing = await run({ command: 'view', path: '/memories' });
    expect(text(listing)).toContain('a.md');
    const content = await run({ command: 'view', path: '/memories/a.md' });
    expect(text(content)).toMatch(/1.*line1/);
    expect(text(content)).toMatch(/2.*line2/);
  });

  it('view with view_range returns only requested lines', async () => {
    await run({ command: 'create', path: '/memories/a.md', file_text: 'l1\nl2\nl3\nl4' });
    const result = await run({ command: 'view', path: '/memories/a.md', view_range: [2, 3] });
    expect(text(result)).toContain('l2');
    expect(text(result)).toContain('l3');
    expect(text(result)).not.toContain('l4');
  });

  it('str_replace replaces a unique occurrence', async () => {
    await run({ command: 'create', path: '/memories/a.md', file_text: 'foo bar baz' });
    await run({ command: 'str_replace', path: '/memories/a.md', old_str: 'bar', new_str: 'qux' });
    expect(fs.readFileSync(path.join(memoryDir, 'a.md'), 'utf8')).toBe('foo qux baz');
  });

  it('str_replace errors on missing and non-unique old_str', async () => {
    await run({ command: 'create', path: '/memories/a.md', file_text: 'dup dup' });
    const missing = await run({
      command: 'str_replace',
      path: '/memories/a.md',
      old_str: 'nope',
      new_str: 'x',
    });
    expect((missing.details as any).error).toBe('not_found');
    const dup = await run({
      command: 'str_replace',
      path: '/memories/a.md',
      old_str: 'dup',
      new_str: 'x',
    });
    expect((dup.details as any).error).toBe('not_unique');
  });

  it('insert adds text after the given line (0 = top)', async () => {
    await run({ command: 'create', path: '/memories/a.md', file_text: 'l1\nl2' });
    await run({ command: 'insert', path: '/memories/a.md', insert_line: 1, insert_text: 'mid' });
    expect(fs.readFileSync(path.join(memoryDir, 'a.md'), 'utf8')).toBe('l1\nmid\nl2');
  });

  it('delete removes files; refuses the root', async () => {
    await run({ command: 'create', path: '/memories/a.md', file_text: 'x' });
    await run({ command: 'delete', path: '/memories/a.md' });
    expect(fs.existsSync(path.join(memoryDir, 'a.md'))).toBe(false);
    const root = await run({ command: 'delete', path: '/memories' });
    expect((root.details as any).error).toBe('cannot_delete_root');
  });

  it('rename moves a file', async () => {
    await run({ command: 'create', path: '/memories/a.md', file_text: 'x' });
    await run({ command: 'rename', old_path: '/memories/a.md', new_path: '/memories/b.md' });
    expect(fs.existsSync(path.join(memoryDir, 'b.md'))).toBe(true);
    expect(fs.existsSync(path.join(memoryDir, 'a.md'))).toBe(false);
  });

  it('rename refuses to overwrite an existing target', async () => {
    await run({ command: 'create', path: '/memories/a.md', file_text: 'source' });
    await run({ command: 'create', path: '/memories/b.md', file_text: 'target' });
    const result = await run({
      command: 'rename',
      old_path: '/memories/a.md',
      new_path: '/memories/b.md',
    });
    expect((result.details as any).error).toBe('target_exists');
    expect(fs.readFileSync(path.join(memoryDir, 'b.md'), 'utf8')).toBe('target');
  });

  it('delete refuses directories by default', async () => {
    await run({ command: 'create', path: '/memories/dir/a.md', file_text: 'x' });
    const result = await run({ command: 'delete', path: '/memories/dir' });
    expect((result.details as any).error).toBe('cannot_delete_directory');
    expect(fs.existsSync(path.join(memoryDir, 'dir/a.md'))).toBe(true);
  });

  it('rejects oversized memory writes', async () => {
    const result = await run({
      command: 'create',
      path: '/memories/large.md',
      file_text: 'x'.repeat(1024 * 1024 + 1),
    });
    expect((result.details as any).error).toBe('content_too_large');
    expect((result.details as any).maxBytes).toBe(1024 * 1024);
  });

  it('rejects path traversal, absolute escapes, and non-/memories paths', async () => {
    for (const bad of ['/memories/../../etc/passwd', '/etc/passwd', 'a.md', '/memories/../x']) {
      const result = await run({ command: 'view', path: bad });
      expect((result.details as any).ok).toBe(false);
    }
  });

  it('rejects symlinked targets', async () => {
    const outside = path.join(os.tmpdir(), `zclaudia-outside-${Date.now()}.md`);
    fs.writeFileSync(outside, 'secret');
    fs.symlinkSync(outside, path.join(memoryDir, 'link.md'));
    const result = await run({ command: 'view', path: '/memories/link.md' });
    expect((result.details as any).error).toBe('symlink_not_allowed');
    fs.rmSync(outside, { force: true });
  });

  it('view on the root before any create returns an empty listing, not an error', async () => {
    fs.rmdirSync(memoryDir);
    const result = await run({ command: 'view', path: '/memories' });
    expect((result.details as any).ok).toBe(true);
    expect(text(result)).toContain('no memories yet');
  });

  it('rejects dangling symlinks (create must not write through them)', async () => {
    const outside = path.join(os.tmpdir(), `zclaudia-dangling-${Date.now()}.md`);
    fs.symlinkSync(outside, path.join(memoryDir, 'dangling.md'));
    const result = await run({ command: 'create', path: '/memories/dangling.md', file_text: 'x' });
    expect((result.details as any).error).toBe('symlink_not_allowed');
    expect(fs.existsSync(outside)).toBe(false);
  });
});
