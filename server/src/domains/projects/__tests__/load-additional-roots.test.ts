import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadProjectAdditionalRoots } from '../additional-paths.js';

let tmp: string;
let extra: string;

function fakeDb(raw: unknown) {
  return {
    prepare: () => ({ get: () => (raw === undefined ? undefined : { additional_paths: raw }) }),
  };
}

beforeAll(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'addl-roots-')));
  extra = path.join(tmp, 'extra');
  fs.mkdirSync(extra);
});
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('loadProjectAdditionalRoots', () => {
  it('returns [] for a project without additional paths', () => {
    expect(loadProjectAdditionalRoots(fakeDb(null), 'p')).toEqual([]);
    expect(loadProjectAdditionalRoots(fakeDb(undefined), 'p')).toEqual([]);
  });

  it('returns [] for a malformed column instead of throwing', () => {
    expect(loadProjectAdditionalRoots(fakeDb('{nope'), 'p')).toEqual([]);
  });

  it('returns existing directories', () => {
    expect(loadProjectAdditionalRoots(fakeDb(JSON.stringify([extra])), 'p')).toEqual([extra]);
  });

  it('skips missing entries with a warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const gone = path.join(tmp, 'gone');
    expect(loadProjectAdditionalRoots(fakeDb(JSON.stringify([gone, extra])), 'p')).toEqual([extra]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(gone));
    warn.mockRestore();
  });

  it('skips non-directories and relative entries', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const file = path.join(tmp, 'f.txt');
    fs.writeFileSync(file, 'x');
    expect(loadProjectAdditionalRoots(fakeDb(JSON.stringify([file, 'rel/dir'])), 'p')).toEqual([]);
    warn.mockRestore();
  });
});
