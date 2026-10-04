import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  findFirstSourceFile,
  findOnPath,
  findWorkspaceTsserver,
  memoizeByRoot,
} from '../detection.js';
import { createPathPreset } from '../presets.js';

describe('language-server detection', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'lsp-detect-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function file(relative: string, content = '', mode?: number) {
    const target = path.join(dir, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
    if (mode !== undefined) chmodSync(target, mode);
    return target;
  }

  it.skipIf(process.platform === 'win32')(
    'finds executables on PATH and skips non-executables',
    () => {
      const bin = path.join(dir, 'bin');
      file('bin/fake-ls', '#!/bin/sh\n', 0o755);
      file('bin/not-exec', 'x', 0o644);
      expect(findOnPath('fake-ls', bin)).toBe(path.join(bin, 'fake-ls'));
      expect(findOnPath('not-exec', bin)).toBeNull();
      expect(findOnPath('missing-language-server-xyz', bin)).toBeNull();
    }
  );

  it('finds TypeScript upwards first, then in workspace packages', () => {
    const nested = file('packages/app/node_modules/typescript/lib/tsserver.js');
    expect(findWorkspaceTsserver(dir)).toBe(nested);
    const hoisted = file('node_modules/typescript/lib/tsserver.js');
    // Upwards wins and the nearest install wins: a package with its own copy
    // uses it, any other directory falls back to the hoisted one.
    expect(findWorkspaceTsserver(path.join(dir, 'packages', 'app', 'src'))).toBe(nested);
    expect(findWorkspaceTsserver(path.join(dir, 'packages', 'other'))).toBe(hoisted);
  });

  it('picks the first real source file, skipping dependencies, output and .d.ts', () => {
    file('node_modules/dep/index.ts');
    file('dist/out.ts');
    file('types/global.d.ts');
    const source = file('src/main.ts');
    expect(findFirstSourceFile(dir, ['.ts'])).toBe(source);
    expect(findFirstSourceFile(dir, ['.go'])).toBeNull();
  });

  it('memoizes per root for the TTL', () => {
    let clock = 0;
    let calls = 0;
    const probe = memoizeByRoot(
      () => ++calls,
      100,
      () => clock
    );
    probe(dir);
    probe(dir);
    expect(calls).toBe(1);
    clock = 101;
    probe(dir);
    expect(calls).toBe(2);
  });

  it('enables a PATH preset only with a root marker and a found executable', () => {
    let found: string | null = '/usr/bin/gopls';
    const preset = createPathPreset(
      {
        id: 'gopls',
        name: 'Go',
        languages: ['go'],
        extensions: { '.go': 'go' },
        rootMarkers: ['go.mod'],
        command: 'gopls',
        args: ['serve'],
      },
      () => found
    );
    expect(preset.resolveLaunch(dir)).toBeNull();
    file('go.mod', 'module x\n');
    const other = mkdtempSync(path.join(tmpdir(), 'lsp-detect-other-'));
    try {
      expect(preset.resolveLaunch(dir)).toEqual({
        command: '/usr/bin/gopls',
        args: ['serve'],
        cwd: dir,
      });
      found = null; // memoized: a later probe within the TTL keeps the answer
      expect(preset.resolveLaunch(dir)).not.toBeNull();
      expect(preset.resolveLaunch(other)).toBeNull(); // no marker there
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });
});
