import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { buildReviewPrompt } from '../review-prompt.js';
import type { LocalPR } from '../types.js';

function makePR(overrides: Partial<LocalPR>): LocalPR {
  return {
    id: 'pr-1',
    branchName: 'feature/x',
    baseBranch: 'main',
    worktreePath: '/tmp/does-not-exist-zzz',
    diffSummary: 'small diff',
    ...overrides,
  } as LocalPR;
}

describe('buildReviewPrompt', () => {
  it('inlines small diffs directly into the prompt', async () => {
    const prompt = await buildReviewPrompt(makePR({ diffSummary: 'tiny change' }));
    expect(prompt).toContain('`feature/x` → `main`');
    expect(prompt).toContain('tiny change');
    expect(prompt).toContain('[REVIEW_PASSED]');
    expect(prompt).not.toContain('too large to inline');
  });

  it('writes an oversized diff to the worktree and references it with a preview', async () => {
    const worktreePath = mkdtempSync(path.join(tmpdir(), 'zc-review-prompt-'));
    try {
      const huge = 'x'.repeat(20000);
      const prompt = await buildReviewPrompt(makePR({ diffSummary: huge, worktreePath }));
      expect(prompt).toContain('too large to inline');
      expect(prompt).toContain('truncated preview');
      // The full diff is never inlined for oversized inputs.
      expect(prompt).not.toContain('x'.repeat(20000));
      // And the patch file is written under the worktree.
      expect(
        existsSync(path.join(worktreePath, '.zclaudia', 'local-pr-review', 'pr-1.diff.patch'))
      ).toBe(true);
    } finally {
      rmSync(worktreePath, { recursive: true, force: true });
    }
  });

  it('handles a missing diff summary', async () => {
    const prompt = await buildReviewPrompt(makePR({ diffSummary: undefined }));
    expect(prompt).toContain('(no diff available)');
  });
});
