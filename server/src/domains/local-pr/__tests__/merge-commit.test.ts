import { describe, expect, it, vi } from 'vitest';
import { resolveMergeCommitSha } from '../merge-commit.js';
import type { LocalPR } from '../types.js';

function makePR(overrides: Partial<LocalPR>): LocalPR {
  return { id: 'pr-1', title: 'My change', mergeCommitSha: undefined, ...overrides } as LocalPR;
}

describe('resolveMergeCommitSha', () => {
  it('returns the recorded sha without shelling out', async () => {
    const exec = vi.fn();
    const sha = await resolveMergeCommitSha(makePR({ mergeCommitSha: 'abc123' }), '/repo', exec);
    expect(sha).toBe('abc123');
    expect(exec).not.toHaveBeenCalled();
  });

  it('matches the merge commit by PR-title subject', async () => {
    const exec = vi.fn().mockResolvedValue({
      stdout: ['deadbeef\x1fMerge Local PR: My change', 'cafef00d\x1fUnrelated merge'].join('\n'),
    });
    const sha = await resolveMergeCommitSha(makePR({ title: 'My change' }), '/repo', exec);
    expect(sha).toBe('deadbeef');
    expect(exec).toHaveBeenCalledWith('git', expect.arrayContaining(['log', '--merges']), {
      cwd: '/repo',
    });
  });

  it('returns null when no merge commit matches', async () => {
    const exec = vi.fn().mockResolvedValue({ stdout: 'cafef00d\x1fSomething else' });
    expect(await resolveMergeCommitSha(makePR({ title: 'My change' }), '/repo', exec)).toBeNull();
  });

  it('accepts Buffer stdout', async () => {
    const exec = vi
      .fn()
      .mockResolvedValue({ stdout: Buffer.from('feedface\x1fMerge Local PR: My change') });
    expect(await resolveMergeCommitSha(makePR({ title: 'My change' }), '/repo', exec)).toBe(
      'feedface'
    );
  });
});
