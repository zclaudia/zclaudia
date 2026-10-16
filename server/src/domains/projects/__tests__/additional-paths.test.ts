import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAX_ADDITIONAL_PATHS, normalizeAdditionalPaths } from '../additional-paths.js';

let tmp: string;
let root: string;
let extraA: string;
let extraB: string;

beforeAll(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'addl-paths-')));
  root = path.join(tmp, 'root');
  extraA = path.join(tmp, 'extra-a');
  extraB = path.join(tmp, 'extra-b');
  for (const dir of [root, extraA, extraB, path.join(extraA, 'nested'), path.join(root, 'sub')]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(path.join(tmp, 'a-file.txt'), 'x');
});

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('normalizeAdditionalPaths', () => {
  it('returns an empty list without requiring a root', () => {
    expect(normalizeAdditionalPaths(undefined, [])).toEqual([]);
  });

  it('requires a root path when paths are given', () => {
    expect(() => normalizeAdditionalPaths(undefined, [extraA])).toThrow(/root path/);
  });

  it('keeps valid directories in caller order', () => {
    expect(normalizeAdditionalPaths(root, [extraB, extraA])).toEqual([extraB, extraA]);
  });

  it('keeps first-occurrence order when the list has duplicates', () => {
    expect(normalizeAdditionalPaths(root, [extraA, extraB, extraA])).toEqual([extraA, extraB]);
  });

  it('rejects relative, missing and non-directory entries', () => {
    expect(() => normalizeAdditionalPaths(root, ['relative/dir'])).toThrow(/absolute/);
    expect(() => normalizeAdditionalPaths(root, [path.join(tmp, 'nope')])).toThrow(/must exist/);
    expect(() => normalizeAdditionalPaths(root, [path.join(tmp, 'a-file.txt')])).toThrow(
      /must be a directory/
    );
  });

  it('drops duplicates, the root itself, and anything nested in the root or another entry', () => {
    expect(
      normalizeAdditionalPaths(root, [
        extraA,
        extraA,
        root,
        path.join(root, 'sub'),
        path.join(extraA, 'nested'),
      ])
    ).toEqual([extraA]);
  });

  it('lets a parent absorb a child listed before it', () => {
    expect(normalizeAdditionalPaths(root, [path.join(extraA, 'nested'), extraA])).toEqual([extraA]);
  });

  it('does not treat a sibling with a shared prefix as nested', () => {
    const sibling = path.join(tmp, 'root-extra');
    fs.mkdirSync(sibling);
    expect(normalizeAdditionalPaths(root, [sibling])).toEqual([sibling]);
  });

  it('resolves symlinks so a link into the root is redundant', () => {
    const link = path.join(tmp, 'link-to-sub');
    fs.symlinkSync(path.join(root, 'sub'), link);
    expect(normalizeAdditionalPaths(root, [link])).toEqual([]);
  });

  it('rejects the filesystem root, the home directory and credential locations', () => {
    expect(() => normalizeAdditionalPaths(root, ['/'])).toThrow(/filesystem root/);
    expect(() => normalizeAdditionalPaths(root, [os.homedir()])).toThrow(/home directory/);
    const ssh = path.join(os.homedir(), '.ssh');
    if (fs.existsSync(ssh)) {
      expect(() => normalizeAdditionalPaths(root, [ssh])).toThrow(/credentials/);
    }
  });

  it('rejects the data directory', () => {
    const prev = process.env.ZCLAUDIA_DATA_DIR;
    process.env.ZCLAUDIA_DATA_DIR = extraB;
    try {
      expect(() => normalizeAdditionalPaths(root, [extraB])).toThrow(/data directory/);
    } finally {
      if (prev === undefined) delete process.env.ZCLAUDIA_DATA_DIR;
      else process.env.ZCLAUDIA_DATA_DIR = prev;
    }
  });

  it('enforces the maximum count', () => {
    const dirs = Array.from({ length: MAX_ADDITIONAL_PATHS + 1 }, (_, i) => {
      const dir = path.join(tmp, `many-${i}`);
      fs.mkdirSync(dir, { recursive: true });
      return dir;
    });
    expect(() => normalizeAdditionalPaths(root, dirs)).toThrow(/at most/);
  });

  it('skips vanished entries when dropMissing is set', () => {
    expect(
      normalizeAdditionalPaths(root, [path.join(tmp, 'gone'), extraA], { dropMissing: true })
    ).toEqual([extraA]);
  });
});
