import { describe, expect, it } from 'vitest';
import { buildConflictResolutionPrompt } from '../conflict-resolution-prompt.js';

describe('buildConflictResolutionPrompt', () => {
  it('builds a rebase-only conflict resolution prompt for the PR branch', () => {
    const prompt = buildConflictResolutionPrompt({
      branchName: 'feature/chat',
      baseBranch: 'main',
    });

    expect(prompt).toContain("The branch 'feature/chat' has a merge conflict");
    expect(prompt).toContain("You are in the worktree for branch 'feature/chat'");
    expect(prompt).toContain('git rebase main');
    expect(prompt).toContain('Do NOT merge into main');
    expect(prompt).toContain('[CONFLICT_RESOLVED]');
    expect(prompt).toContain('[CONFLICT_UNRESOLVED]');
  });
});
