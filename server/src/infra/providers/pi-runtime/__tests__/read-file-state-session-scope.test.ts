import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

import { buildEffectiveToolOptions } from '../tool-options.js';

async function fixture(content: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'zc-rfs-scope-'));
  const file = path.join(dir, 'sample.ts');
  await writeFile(file, content);
  return file;
}

describe('read-file-state session scoping across runs', () => {
  it('reuses the same store for consecutive runs of the same session', () => {
    const runA = buildEffectiveToolOptions('/tmp', { sessionId: 'scope-same-1' });
    const runB = buildEffectiveToolOptions('/tmp', { sessionId: 'scope-same-1' });
    expect(runA.readFileState).toBe(runB.readFileState);
  });

  it('a read recorded in one run satisfies assertEditable in the next run', async () => {
    const file = await fixture('a\nb\nc\n');
    const runA = buildEffectiveToolOptions('/tmp', { sessionId: 'scope-carry-1' });
    await runA.readFileState!.recordRead(file, {
      content: 'a\nb\nc\n',
      offset: 1,
      limit: 3,
      totalLines: 3,
      returnedLines: 3,
    });

    const runB = buildEffectiveToolOptions('/tmp', { sessionId: 'scope-carry-1' });
    expect(runB.readFileState!.assertEditable(file, 'a\nb\nc\n')).toEqual({ ok: true });
  });

  it('still rejects stale edits across runs when the file changed since read', async () => {
    const file = await fixture('a\nb\nc\n');
    const runA = buildEffectiveToolOptions('/tmp', { sessionId: 'scope-stale-1' });
    await runA.readFileState!.recordRead(file, {
      content: 'a\nb\nc\n',
      offset: 1,
      limit: 3,
      totalLines: 3,
      returnedLines: 3,
    });

    const runB = buildEffectiveToolOptions('/tmp', { sessionId: 'scope-stale-1' });
    expect(runB.readFileState!.assertEditable(file, 'a\nCHANGED\nc\n')).toMatchObject({
      ok: false,
      code: 'file_modified_since_read',
    });
  });

  it('isolates stores between different sessions', () => {
    const runA = buildEffectiveToolOptions('/tmp', { sessionId: 'scope-iso-a' });
    const runB = buildEffectiveToolOptions('/tmp', { sessionId: 'scope-iso-b' });
    expect(runA.readFileState).not.toBe(runB.readFileState);
  });

  it('creates a fresh store per call when no sessionId is available', () => {
    const runA = buildEffectiveToolOptions('/tmp', {});
    const runB = buildEffectiveToolOptions('/tmp', {});
    expect(runA.readFileState).not.toBe(runB.readFileState);
  });

  it('an explicitly injected store takes precedence over session lookup', () => {
    const injected = buildEffectiveToolOptions('/tmp', {}).readFileState!;
    const run = buildEffectiveToolOptions('/tmp', {
      sessionId: 'scope-injected-1',
      readFileState: injected,
    });
    expect(run.readFileState).toBe(injected);
  });
});
