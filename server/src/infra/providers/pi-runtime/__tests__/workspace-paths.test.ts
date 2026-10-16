import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

import {
  isOutsideWorkspace,
  resolveInsidePrimaryWorkspace,
  resolveInsideWorkspace,
  resolveInsideWorkspaces,
} from '../workspace-paths.js';

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

describe('resolveInsideWorkspaces', () => {
  async function setup() {
    const base = await tempRoot('zc-wsp-multi-');
    const primary = path.join(base, 'proj');
    const extra = path.join(base, 'extra');
    const third = path.join(base, 'third');
    const sibling = path.join(base, 'proj-extra');
    for (const d of [primary, extra, third, sibling]) await mkdir(d);
    await writeFile(path.join(extra, 'a.txt'), 'a\n');
    await writeFile(path.join(third, 'secret.txt'), 's\n');
    return { base, primary, extra, third, sibling };
  }

  it('matches the single-root resolver when there are no additional roots', async () => {
    const { base, primary, third } = await setup();
    const roots = { primary };
    expect(resolveInsideWorkspaces(roots, 'src/new.ts')).toBe(path.join(primary, 'src', 'new.ts'));
    expect(resolveInsideWorkspaces(roots, undefined)).toBe(primary);
    expect(() => resolveInsideWorkspaces(roots, path.join(third, 'secret.txt'))).toThrow(
      /Path is outside workspace: /
    );
    await rm(base, { recursive: true, force: true });
  });

  it('allows absolute paths inside an additional root, existing or not', async () => {
    const { base, primary, extra } = await setup();
    const roots = { primary, additional: [extra] };
    expect(resolveInsideWorkspaces(roots, path.join(extra, 'a.txt'))).toBe(
      path.join(extra, 'a.txt')
    );
    expect(resolveInsideWorkspaces(roots, path.join(extra, 'deep', 'new.txt'))).toBe(
      path.join(extra, 'deep', 'new.txt')
    );
    expect(resolveInsideWorkspaces(roots, extra)).toBe(extra);
    await rm(base, { recursive: true, force: true });
  });

  it('resolves relative paths against the primary root only', async () => {
    const { base, primary, extra } = await setup();
    const roots = { primary, additional: [extra] };
    expect(resolveInsideWorkspaces(roots, 'a.txt')).toBe(path.join(primary, 'a.txt'));
    // ../extra/a.txt is relative to the primary root and lands in the additional one.
    expect(resolveInsideWorkspaces(roots, '../extra/a.txt')).toBe(path.join(extra, 'a.txt'));
    await rm(base, { recursive: true, force: true });
  });

  it('rejects a third directory and lists the roots in the error', async () => {
    const { base, primary, extra, third } = await setup();
    const roots = { primary, additional: [extra] };
    expect(() => resolveInsideWorkspaces(roots, path.join(third, 'secret.txt'))).toThrow(
      /Path is outside workspace: .*Allowed roots:/s
    );
    await rm(base, { recursive: true, force: true });
  });

  it('rejects traversal out of an additional root', async () => {
    const { base, primary, extra, third } = await setup();
    const roots = { primary, additional: [extra] };
    expect(() =>
      resolveInsideWorkspaces(roots, path.join(extra, '..', 'third', 'secret.txt'))
    ).toThrow(/outside workspace/);
    await rm(base, { recursive: true, force: true });
  });

  it('does not let a prefix-sharing sibling pass', async () => {
    const { base, primary, sibling } = await setup();
    expect(() => resolveInsideWorkspaces({ primary }, path.join(sibling, 'x.txt'))).toThrow(
      /outside workspace/
    );
    await rm(base, { recursive: true, force: true });
  });

  it('rejects a symlink inside an additional root that escapes it', async () => {
    const { base, primary, extra, third } = await setup();
    await symlink(third, path.join(extra, 'link'));
    const roots = { primary, additional: [extra] };
    expect(() => resolveInsideWorkspaces(roots, path.join(extra, 'link', 'secret.txt'))).toThrow(
      /outside workspace/
    );
    // ...including creating a new file through it.
    expect(() => resolveInsideWorkspaces(roots, path.join(extra, 'link', 'new.txt'))).toThrow(
      /outside workspace/
    );
    await rm(base, { recursive: true, force: true });
  });

  it('keeps resolveInsideWorkspace single-root', async () => {
    const { base, primary, extra } = await setup();
    expect(() => resolveInsideWorkspace(primary, path.join(extra, 'a.txt'))).toThrow(
      /outside workspace/
    );
    await rm(base, { recursive: true, force: true });
  });
});

describe('resolveInsidePrimaryWorkspace', () => {
  it('explains that additional directories are not covered', async () => {
    const base = await tempRoot('zc-wsp-primary-');
    const primary = path.join(base, 'proj');
    const extra = path.join(base, 'extra');
    const third = path.join(base, 'third');
    for (const d of [primary, extra, third]) await mkdir(d);
    const roots = { primary, additional: [extra] };
    expect(resolveInsidePrimaryWorkspace(roots, 'src/a.ts', 'LSPTool')).toBe(
      path.join(primary, 'src', 'a.ts')
    );
    expect(() => resolveInsidePrimaryWorkspace(roots, path.join(extra, 'a.ts'), 'LSPTool')).toThrow(
      /LSPTool only supports files under the primary workspace root.*additional directory/s
    );
    expect(() => resolveInsidePrimaryWorkspace(roots, path.join(third, 'a.ts'), 'LSPTool')).toThrow(
      /Path is outside workspace/
    );
    await rm(base, { recursive: true, force: true });
  });
});
