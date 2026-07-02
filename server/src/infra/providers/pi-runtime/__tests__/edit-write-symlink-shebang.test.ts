import { describe, expect, it } from 'vitest';
import { lstat, mkdtemp, readFile, realpath, stat, symlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

import { createWriteBridgeTool, createEditBridgeTool } from '../edit-write-tools.js';
import { createReadFileStateStore } from '../read-file-state.js';

async function tempRoot(label: string): Promise<string> {
  // realpath so the workspace root matches realpath() of files inside it
  // (macOS /tmp -> /private/tmp), keeping symlink-target containment checks honest.
  return realpath(await mkdtemp(path.join(tmpdir(), label)));
}

describe('Write shebang auto-chmod', () => {
  it('marks a newly written shebang file executable', async () => {
    const root = await tempRoot('zclaudia-shebang-');
    const write = createWriteBridgeTool(root) as any;

    const result = await write.execute('w1', {
      file_path: 'run.sh',
      content: '#!/bin/bash\necho hi\n',
    });

    expect(result.details).toMatchObject({ ok: true, madeExecutable: true });
    const mode = (await stat(path.join(root, 'run.sh'))).mode;
    expect(mode & 0o111).not.toBe(0);
  });

  it('leaves a non-shebang file without execute bits', async () => {
    const root = await tempRoot('zclaudia-noshebang-');
    const write = createWriteBridgeTool(root) as any;

    const result = await write.execute('w1', { file_path: 'data.txt', content: 'plain text\n' });

    expect(result.details.madeExecutable).toBeUndefined();
    const mode = (await stat(path.join(root, 'data.txt'))).mode;
    expect(mode & 0o111).toBe(0);
  });
});

describe('Write/Edit symlink passthrough', () => {
  it('writes through a symlink to its target, keeping the link intact', async () => {
    const root = await tempRoot('zclaudia-symlink-write-');
    await writeFile(path.join(root, 'target.txt'), 'old\n');
    await symlink(path.join(root, 'target.txt'), path.join(root, 'link.txt'));
    const write = createWriteBridgeTool(root) as any;

    const result = await write.execute('w1', { file_path: 'link.txt', content: 'new\n' });

    expect(result.details.ok).toBe(true);
    expect((await lstat(path.join(root, 'link.txt'))).isSymbolicLink()).toBe(true);
    expect(await readFile(path.join(root, 'target.txt'), 'utf8')).toBe('new\n');
  });

  it('edits through a symlink to its target, keeping the link intact', async () => {
    const root = await tempRoot('zclaudia-symlink-edit-');
    await writeFile(path.join(root, 'target.ts'), 'const a = 1;\n');
    await symlink(path.join(root, 'target.ts'), path.join(root, 'link.ts'));
    const state = createReadFileStateStore();
    // The model reads via the link; reads follow the symlink to the target.
    await state.recordRead(path.join(root, 'link.ts'), {
      content: 'const a = 1;\n',
      offset: 1,
      limit: 2000,
      totalLines: 1,
      returnedLines: 1,
      hasFullContent: true,
    });
    const edit = createEditBridgeTool(root, { readFileState: state }) as any;

    const result = await edit.execute('e1', {
      file_path: 'link.ts',
      old_string: 'const a = 1;',
      new_string: 'const a = 2;',
    });

    expect(result.details.ok).toBe(true);
    expect((await lstat(path.join(root, 'link.ts'))).isSymbolicLink()).toBe(true);
    expect(await readFile(path.join(root, 'target.ts'), 'utf8')).toBe('const a = 2;\n');
  });

  it('refuses to write through a symlink whose target escapes the workspace', async () => {
    const root = await tempRoot('zclaudia-symlink-escape-');
    const outside = await tempRoot('zclaudia-symlink-outside-');
    await writeFile(path.join(outside, 'secret.txt'), 'secret\n');
    await symlink(path.join(outside, 'secret.txt'), path.join(root, 'link.txt'));
    const write = createWriteBridgeTool(root) as any;

    const result = await write.execute('w1', { file_path: 'link.txt', content: 'pwned\n' });

    // Rejected before any write — workspace containment (path_outside_workspace)
    // catches it up front; resolveWritePath's symlink_escape is the backstop.
    expect(result.details.ok).toBe(false);
    expect(result.details.error).toMatch(/symlink_escape|path_outside_workspace/);
    expect(await readFile(path.join(outside, 'secret.txt'), 'utf8')).toBe('secret\n');
  });
});
