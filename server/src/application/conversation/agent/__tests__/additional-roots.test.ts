import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DEFAULT_AI_REVIEW_CONFIG,
  DEFAULT_UNIFIED_PROFILE,
  type UnifiedPermissionPolicy,
} from '@zclaudia/shared/interaction/permissions';
import {
  PermissionEvaluator,
  getMatchedPermissionRule,
  getOutsideWorkspacePaths,
  getOutsideWorkspaceRootsToRemember,
  isOutsideWorkspacePathAllowed,
} from '../permission-evaluator.js';
import { isPathWithinAnyRoot, isPathWithinRoot } from '../shell-parser.js';

let tmp: string;
let primary: string;
let extra: string;
let third: string;
let outside: string;

beforeAll(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'addl-eval-')));
  primary = path.join(tmp, 'proj');
  extra = path.join(tmp, 'extra');
  third = path.join(tmp, 'third');
  outside = path.join(tmp, 'outside');
  for (const d of [primary, extra, third, outside, path.join(tmp, 'proj-extra')]) {
    fs.mkdirSync(d, { recursive: true });
  }
  fs.writeFileSync(path.join(outside, 'secret.txt'), 's');
  // A link inside the additional directory pointing out of it.
  fs.symlinkSync(outside, path.join(extra, 'escape'));
});
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

function policy(): UnifiedPermissionPolicy {
  return {
    enabled: true,
    profile: { ...DEFAULT_UNIFIED_PROFILE },
    globalGuards: { blockSensitiveFiles: false, blockOutsideWorkspace: true },
    customRules: [],
    escalateAlways: [],
    aiReview: { ...DEFAULT_AI_REVIEW_CONFIG },
  };
}

const evaluate = (
  toolName: string,
  input: unknown,
  detail: string,
  additionalRoots?: string[]
): string =>
  new PermissionEvaluator().evaluate(toolName, input, detail, policy(), {
    rootPath: primary,
    additionalRoots,
  });

describe('isPathWithinAnyRoot', () => {
  it('matches any of the roots', () => {
    expect(isPathWithinAnyRoot('/a/one/x', ['/b', '/a/one'])).toBe(true);
    expect(isPathWithinAnyRoot('/a/one', ['/a/one'])).toBe(true);
    expect(isPathWithinAnyRoot('/c/x', ['/b', '/a/one'])).toBe(false);
  });

  it('is false for an empty root list', () => {
    expect(isPathWithinAnyRoot('/a', [])).toBe(false);
  });

  it('does not treat a sibling that shares a prefix as inside', () => {
    expect(isPathWithinAnyRoot('/a/proj-extra/x', ['/a/proj'])).toBe(false);
    expect(isPathWithinAnyRoot('/a/proj-extra', ['/a/proj'])).toBe(false);
  });

  it('collapses .. traversal lexically', () => {
    expect(isPathWithinAnyRoot('/a/extra/../secret', ['/a/extra'])).toBe(false);
    expect(isPathWithinAnyRoot('/a/extra/sub/../ok', ['/a/extra'])).toBe(true);
  });

  it('keeps isPathWithinRoot unchanged', () => {
    expect(isPathWithinRoot('/a/proj/x', '/a/proj')).toBe(true);
    expect(isPathWithinRoot('/a/proj-extra', '/a/proj')).toBe(false);
  });
});

describe('getOutsideWorkspacePaths with additional roots', () => {
  it('behaves exactly as before without additional roots', () => {
    const file = path.join(extra, 'a.txt');
    expect(getOutsideWorkspacePaths('Write', { file_path: file }, '', primary)).toEqual([file]);
    expect(getOutsideWorkspacePaths('Write', { file_path: file }, '', primary, [])).toEqual([file]);
  });

  it('does not report files inside an additional root', () => {
    const file = path.join(extra, 'a.txt');
    expect(getOutsideWorkspacePaths('Write', { file_path: file }, '', primary, [extra])).toEqual(
      []
    );
  });

  it('still reports a third directory', () => {
    const file = path.join(third, 'a.txt');
    expect(getOutsideWorkspacePaths('Write', { file_path: file }, '', primary, [extra])).toEqual([
      file,
    ]);
  });

  it('rejects traversal out of an additional root', () => {
    const file = path.join(extra, '..', 'third', 'a.txt');
    expect(getOutsideWorkspacePaths('Write', { file_path: file }, '', primary, [extra])).toEqual([
      path.join(third, 'a.txt'),
    ]);
  });

  it('does not let a prefix-sharing sibling pass', () => {
    const file = path.join(tmp, 'proj-extra', 'a.txt');
    expect(getOutsideWorkspacePaths('Write', { file_path: file }, '', primary, [])).toEqual([file]);
    expect(
      getOutsideWorkspacePaths('Write', { file_path: file }, '', primary, [path.join(tmp, 'proj')])
    ).toEqual([file]);
  });

  it('rejects a symlink inside an additional root that points outside it', () => {
    const file = path.join(extra, 'escape', 'secret.txt');
    expect(getOutsideWorkspacePaths('Read', { file_path: file }, '', primary, [extra])).toEqual([
      file,
    ]);
  });

  it('rejects writing a new file under an escaping symlink (missing leaf)', () => {
    const file = path.join(extra, 'escape', 'new.txt');
    expect(getOutsideWorkspacePaths('Write', { file_path: file }, '', primary, [extra])).toEqual([
      file,
    ]);
  });

  it('allows a not-yet-existing file under a real additional directory', () => {
    const file = path.join(extra, 'deep', 'new.txt');
    expect(getOutsideWorkspacePaths('Write', { file_path: file }, '', primary, [extra])).toEqual(
      []
    );
  });

  it('analyses Bash commands against both roots', () => {
    const cmd = `cp ${path.join(extra, 'a')} ${path.join(third, 'b')}`;
    expect(getOutsideWorkspacePaths('Bash', { command: cmd }, cmd, primary, [extra])).toEqual([
      path.join(third, 'b'),
    ]);
    const ok = `cat ${path.join(extra, 'a')} > ${path.join(primary, 'b')}`;
    expect(getOutsideWorkspacePaths('Bash', { command: ok }, ok, primary, [extra])).toEqual([]);
  });

  it('resolves relative Bash paths against the primary root, not the additional one', () => {
    // ./../extra/a.txt from the primary root is inside the additional dir.
    const inside = 'cat ./../extra/a.txt';
    expect(getOutsideWorkspacePaths('Bash', { command: inside }, inside, primary, [extra])).toEqual(
      []
    );
    // ./../third/a.txt is not.
    const out = 'cat ./../third/a.txt';
    expect(getOutsideWorkspacePaths('Bash', { command: out }, out, primary, [extra])).toEqual([
      path.join(third, 'a.txt'),
    ]);
    // A bare relative name stays in the primary root.
    expect(
      getOutsideWorkspacePaths('Bash', { command: 'cat ./a.txt' }, '', primary, [extra])
    ).toEqual([]);
  });

  it('does not treat cd into an additional dir as moving the relative base', () => {
    // Relative paths stay primary-based even after a `cd`; `./../secret` from the
    // primary root is tmp/secret, outside every root.
    const cmd = `cd ${extra} && cat ./../secret`;
    const outsidePaths = getOutsideWorkspacePaths('Bash', { command: cmd }, cmd, primary, [extra]);
    expect(outsidePaths).toContain(path.join(tmp, 'secret'));
  });
});

describe('remembered roots and allow-list with additional roots', () => {
  it('does not offer to remember additional roots', () => {
    const file = path.join(extra, 'a.txt');
    expect(
      getOutsideWorkspaceRootsToRemember('Read', { file_path: file }, '', primary, [extra])
    ).toEqual([]);
    expect(getOutsideWorkspaceRootsToRemember('Read', { file_path: file }, '', primary)).toEqual([
      extra,
    ]);
  });

  it('isOutsideWorkspacePathAllowed unions learned and additional roots', () => {
    const e = path.join(extra, 'a.txt');
    const t = path.join(third, 'a.txt');
    const cmd = `cat ${e} ${t}`;
    // third is learned, extra is configured: together everything is allowed.
    expect(
      isOutsideWorkspacePathAllowed('Bash', { command: cmd }, cmd, primary, [third], [extra])
    ).toBe(true);
    // Without the learned root the third dir is still outside.
    expect(isOutsideWorkspacePathAllowed('Bash', { command: cmd }, cmd, primary, [], [extra])).toBe(
      false
    );
  });
});

describe('PermissionEvaluator with additional roots', () => {
  it('escalates additional-dir writes only when no additional root is configured', () => {
    const file = path.join(extra, 'a.txt');
    expect(evaluate('Write', { file_path: file }, '')).toBe('escalate');
    expect(evaluate('Write', { file_path: file }, '', [])).toBe('escalate');
    expect(evaluate('Write', { file_path: file }, '', [extra])).not.toBe('escalate');
  });

  it('still escalates a write to a third directory', () => {
    expect(evaluate('Write', { file_path: path.join(third, 'a.txt') }, '', [extra])).toBe(
      'escalate'
    );
  });

  it('escalates the symlink escape', () => {
    expect(
      evaluate('Read', { file_path: path.join(extra, 'escape', 'secret.txt') }, '', [extra])
    ).toBe('escalate');
  });

  it('getMatchedPermissionRule agrees', () => {
    const file = path.join(extra, 'a.txt');
    const ctx = { rootPath: primary, additionalRoots: [extra] };
    expect(getMatchedPermissionRule('Write', { file_path: file }, '', policy(), ctx)).toBeNull();
    expect(
      getMatchedPermissionRule('Write', { file_path: file }, '', policy(), { rootPath: primary })
    ).toBe('Outside workspace access');
  });

  it('Bash writes into the additional dir do not escalate for outside-workspace', () => {
    const cmd = `touch ${path.join(extra, 'x')}`;
    expect(
      getMatchedPermissionRule('Bash', { command: cmd }, cmd, policy(), {
        rootPath: primary,
        additionalRoots: [extra],
      })
    ).not.toBe('Outside workspace access');
  });
});
