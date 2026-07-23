import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

import { isOutsideWorkspace, resolveInsideWorkspace } from '../workspace-paths.js';

async function tempRoot(label: string): Promise<string> {
  // realpath so the workspace root matches realpath() of files inside it
  // (macOS /tmp -> /private/tmp), mirroring the resolver's canonicalisation.
  return realpath(await mkdtemp(path.join(tmpdir(), label)));
}

describe('isOutsideWorkspace', () => {
  it('treats only ".." itself and "../" prefixes as escapes', () => {
    expect(isOutsideWorkspace('..')).toBe(true);
    expect(isOutsideWorkspace(`..${path.sep}evil`)).toBe(true);
    expect(isOutsideWorkspace(`..${path.sep}..${path.sep}evil`)).toBe(true);
    expect(isOutsideWorkspace('..data')).toBe(false);
    expect(isOutsideWorkspace('...config')).toBe(false);
    expect(isOutsideWorkspace(`src${path.sep}..data`)).toBe(false);
    expect(isOutsideWorkspace('')).toBe(false);
  });
});

describe('resolveInsideWorkspace', () => {
  it('accepts legitimate names that start with ".."', async () => {
    const root = await tempRoot('zc-wsp-dotdot-');
    await mkdir(path.join(root, '..data'));
    await writeFile(path.join(root, '..data', 'f.txt'), 'x\n');
    await writeFile(path.join(root, '...config'), 'y\n');

    expect(resolveInsideWorkspace(root, '..data/f.txt')).toBe(path.join(root, '..data', 'f.txt'));
    expect(resolveInsideWorkspace(root, '...config')).toBe(path.join(root, '...config'));
    // A not-yet-existing file under a dot-prefixed directory is fine too.
    expect(resolveInsideWorkspace(root, '..data/new.txt')).toBe(
      path.join(root, '..data', 'new.txt')
    );

    await rm(root, { recursive: true, force: true });
  });

  it('rejects real escapes', async () => {
    const root = await tempRoot('zc-wsp-escape-');
    const outside = await tempRoot('zc-wsp-outside-');
    await writeFile(path.join(outside, 'secret.txt'), 'secret\n');

    expect(() => resolveInsideWorkspace(root, '../outside')).toThrow(/outside workspace/);
    expect(() => resolveInsideWorkspace(root, path.join(outside, 'secret.txt'))).toThrow(
      /outside workspace/
    );
    expect(() => resolveInsideWorkspace(root, '..')).toThrow(/outside workspace/);

    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  it('rejects a symlink whose target escapes the workspace', async () => {
    const root = await tempRoot('zc-wsp-symlink-');
    const outside = await tempRoot('zc-wsp-symlink-outside-');
    await writeFile(path.join(outside, 'secret.txt'), 'secret\n');
    await symlink(path.join(outside, 'secret.txt'), path.join(root, 'link.txt'));

    expect(() => resolveInsideWorkspace(root, 'link.txt')).toThrow(/outside workspace/);

    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  it('resolves against the real path of a symlinked workspace root', async () => {
    const real = await tempRoot('zc-wsp-real-');
    await mkdir(path.join(real, '..data'));
    await writeFile(path.join(real, '..data', 'f.txt'), 'x\n');
    await writeFile(path.join(real, 'plain.txt'), 'p\n');
    const linkParent = await tempRoot('zc-wsp-linkparent-');
    const linkRoot = path.join(linkParent, 'ws-link');
    await symlink(real, linkRoot);

    // Through the symlinked root, in-workspace paths (including dot-prefixed
    // names) resolve, while escapes are still rejected.
    expect(resolveInsideWorkspace(linkRoot, 'plain.txt')).toBe(
      path.join(path.resolve(linkRoot), 'plain.txt')
    );
    expect(resolveInsideWorkspace(linkRoot, '..data/f.txt')).toBe(
      path.join(path.resolve(linkRoot), '..data', 'f.txt')
    );
    expect(() => resolveInsideWorkspace(linkRoot, '../outside')).toThrow(/outside workspace/);

    await rm(real, { recursive: true, force: true });
    await rm(linkParent, { recursive: true, force: true });
  });
});
