import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { buildTools } from '../tool-bridge.js';
import { hashlineForLine, replaceHashlineLine } from '../hashline.js';

function makeWorkspace(): string {
  return mkdtempSync(path.join(tmpdir(), 'zc-hashline-'));
}

function getTools(dir: string): Record<string, any> {
  const tools = buildTools(dir, { enabled: ['Read', 'Edit', 'Write'] });
  return Object.fromEntries(tools.map(t => [t.name, t]));
}

describe('replaceHashlineLine with snapshot disambiguation', () => {
  it('replaces the only matching line without a snapshot', () => {
    const content = 'alpha\nbeta\ngamma\n';
    const updated = replaceHashlineLine(content, hashlineForLine('beta'), 'BETA');
    expect(updated).toBe('alpha\nBETA\ngamma\n');
  });

  it('disambiguates duplicate lines using snapshot context', () => {
    // Model saw the snapshot and targeted the closer() inside stop(); the
    // current file gained a new first function so blind first-match is wrong.
    const snapshot = 'function start() {\n  closer();\n}\nfunction stop() {\n  closer();\n}\n';
    // Model's anchor: the second occurrence (inside stop()) — same hash both times.
    const hash = hashlineForLine('  closer();');
    // Current drifted: a new function with another closer() call was prepended.
    const current = 'function boot() {\n  closer();\n}\n' + snapshot;
    // Without context the first match (inside boot) would be replaced. With the
    // snapshot, context around the snapshot's first occurrence (inside start) wins.
    const updated = replaceHashlineLine(current, hash, '  CLOSER();', snapshot);
    expect(updated).toBe(
      'function boot() {\n  closer();\n}\nfunction start() {\n  CLOSER();\n}\nfunction stop() {\n  closer();\n}\n'
    );
  });

  it('returns undefined when the anchored line no longer exists', () => {
    const updated = replaceHashlineLine('a\nb\n', hashlineForLine('gone'), 'X', 'a\ngone\nb\n');
    expect(updated).toBeUndefined();
  });
});

describe('replaceHashlineLine CRLF round-trip', () => {
  it('matches read-side anchors (CR stripped) against CRLF content', () => {
    // Read builds anchors from text.split(/\r?\n/), so hashes never see '\r'.
    const content = 'alpha\r\nbeta\r\ngamma\r\n';
    const updated = replaceHashlineLine(content, hashlineForLine('beta'), 'BETA');
    // Output is LF-normalized; the Edit tool re-applies the file's CRLF style
    // on write (applyLineEndingStyle).
    expect(updated).toBe('alpha\nBETA\ngamma\n');
  });

  it('preserves a missing trailing newline on CRLF content', () => {
    const updated = replaceHashlineLine('alpha\r\nbeta', hashlineForLine('beta'), 'BETA');
    expect(updated).toBe('alpha\nBETA');
  });

  it('disambiguates duplicates in CRLF content with a CRLF snapshot', () => {
    const snapshot = 'function a() {\r\n  go();\r\n}\r\nfunction b() {\r\n  go();\r\n}\r\n';
    const current = 'function z() {\r\n  go();\r\n}\r\n' + snapshot;
    const updated = replaceHashlineLine(current, hashlineForLine('  go();'), '  GO();', snapshot);
    expect(updated).toBe(
      'function z() {\n  go();\n}\nfunction a() {\n  GO();\n}\nfunction b() {\n  go();\n}\n'
    );
  });

  it('read-side anchors from a CRLF file match at edit time (integration)', async () => {
    const dir = makeWorkspace();
    writeFileSync(
      path.join(dir, 'crlf.ts'),
      'const a = 1;\r\nconst target = "old";\r\nconst b = 2;\r\n'
    );
    const tools = getTools(dir);
    const read = await tools.Read.execute('r1', { path: 'crlf.ts', hashline: true });
    const anchor = read.details.hashline.lines.find((l: { text: string }) =>
      l.text.includes('target')
    );

    const res = await tools.Edit.execute('e1', {
      file_path: 'crlf.ts',
      hashline_operation: `replace:${anchor.hash}`,
      hashline_tag: read.details.hashline.tag,
      new_string: 'const target = "new";',
    });
    const after = readFileSync(path.join(dir, 'crlf.ts'), 'utf8');
    rmSync(dir, { recursive: true, force: true });
    expect(res.details.ok).toBe(true);
    // The file's CRLF style is preserved on write.
    expect(after).toBe('const a = 1;\r\nconst target = "new";\r\nconst b = 2;\r\n');
  });
});

describe('hashline edit drift tolerance (integration)', () => {
  it('edits the anchored line even after the file drifted out-of-band', async () => {
    const dir = makeWorkspace();
    writeFileSync(path.join(dir, 'f.ts'), 'const a = 1;\nconst target = "old";\nconst b = 2;\n');
    const tools = getTools(dir);
    const read = await tools.Read.execute('r1', { path: 'f.ts', hashline: true });
    const anchor = read.details.hashline.lines.find((l: { text: string }) =>
      l.text.includes('target')
    );

    // Out-of-band drift: lines prepended, tag now stale.
    writeFileSync(
      path.join(dir, 'f.ts'),
      '// new header\nconst a = 1;\nconst target = "old";\nconst b = 2;\n'
    );

    const res = await tools.Edit.execute('e1', {
      file_path: 'f.ts',
      hashline_operation: `replace:${anchor.hash}`,
      hashline_tag: read.details.hashline.tag,
      new_string: 'const target = "new";',
    });
    const after = readFileSync(path.join(dir, 'f.ts'), 'utf8');
    rmSync(dir, { recursive: true, force: true });
    expect(res.details.ok).toBe(true);
    expect(res.details.hashline.tagDrift).toBe(true);
    expect(after).toBe('// new header\nconst a = 1;\nconst target = "new";\nconst b = 2;\n');
  });

  it('still fails cleanly when the anchored line was changed out-of-band', async () => {
    const dir = makeWorkspace();
    writeFileSync(path.join(dir, 'f.ts'), 'const target = "old";\n');
    const tools = getTools(dir);
    const read = await tools.Read.execute('r1', { path: 'f.ts', hashline: true });
    const anchor = read.details.hashline.lines[0];

    writeFileSync(path.join(dir, 'f.ts'), 'const target = "rewritten elsewhere";\n');

    const res = await tools.Edit.execute('e1', {
      file_path: 'f.ts',
      hashline_operation: `replace:${anchor.hash}`,
      new_string: 'const target = "new";',
    });
    rmSync(dir, { recursive: true, force: true });
    expect(res.details.ok).toBe(false);
    expect(res.details.error).toBe('hashline_mismatch');
  });
});

describe('no-op edit loop guard (integration)', () => {
  it('escalates to edit_loop_detected after repeated identical failures', async () => {
    const dir = makeWorkspace();
    writeFileSync(path.join(dir, 'f.ts'), 'const x = 1;\n');
    const tools = getTools(dir);
    await tools.Read.execute('r1', { path: 'f.ts' });

    const attempt = () =>
      tools.Edit.execute('e', {
        file_path: 'f.ts',
        old_string: 'does not exist anywhere',
        new_string: 'whatever',
      });
    const first = await attempt();
    const second = await attempt();
    const third = await attempt();
    rmSync(dir, { recursive: true, force: true });
    expect(first.details.error).toBe('not_found');
    expect(second.details.error).toBe('not_found');
    expect(third.details.error).toBe('edit_loop_detected');
    expect(third.content[0].text).toContain('Read');
  });

  it('a successful edit resets the failure counter for the file', async () => {
    const dir = makeWorkspace();
    writeFileSync(path.join(dir, 'f.ts'), 'const x = 1;\n');
    const tools = getTools(dir);
    await tools.Read.execute('r1', { path: 'f.ts' });

    const bad = () =>
      tools.Edit.execute('e', {
        file_path: 'f.ts',
        old_string: 'missing text',
        new_string: 'whatever',
      });
    await bad();
    await bad();
    const good = await tools.Edit.execute('e-good', {
      file_path: 'f.ts',
      old_string: 'const x = 1;',
      new_string: 'const x = 2;',
    });
    expect(good.details.ok).toBe(true);
    await tools.Read.execute('r2', { path: 'f.ts' });
    const afterReset = await bad();
    rmSync(dir, { recursive: true, force: true });
    expect(afterReset.details.error).toBe('not_found');
  });

  it('different failed edits do not share a counter', async () => {
    const dir = makeWorkspace();
    writeFileSync(path.join(dir, 'f.ts'), 'const x = 1;\n');
    const tools = getTools(dir);
    await tools.Read.execute('r1', { path: 'f.ts' });

    const attempt = (needle: string) =>
      tools.Edit.execute('e', {
        file_path: 'f.ts',
        old_string: needle,
        new_string: 'whatever',
      });
    await attempt('missing one');
    await attempt('missing two');
    const third = await attempt('missing three');
    rmSync(dir, { recursive: true, force: true });
    expect(third.details.error).toBe('not_found');
  });
});
