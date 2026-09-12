import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import * as path from 'path';
import { listGitWorktrees, createGitWorktree } from '../git-worktrees';

// Mock child_process
vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

describe('git-worktrees', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('listGitWorktrees', () => {
    it('parses a single worktree', () => {
      const mockOutput = `worktree /Users/test/my-project
HEAD abc1234
branch refs/heads/main`;

      vi.mocked(execSync).mockReturnValue(mockOutput);

      const result = listGitWorktrees('/Users/test/my-project');

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        path: path.normalize('/Users/test/my-project'),
        branch: 'main',
        isMain: true,
        commit: 'abc1234',
      });
    });

    it('parses multiple worktrees', () => {
      const mockOutput = `worktree /Users/test/my-project
HEAD abc1234
branch refs/heads/main

worktree /Users/test/my-project-feat
HEAD def5678
branch refs/heads/feat/new-feature`;

      vi.mocked(execSync).mockReturnValue(mockOutput);

      const result = listGitWorktrees('/Users/test/my-project');

      expect(result).toHaveLength(2);
      expect(result[0].isMain).toBe(true);
      expect(result[1].isMain).toBe(false);
      expect(result[0].branch).toBe('main');
      expect(result[1].branch).toBe('feat/new-feature');
    });

    it('handles detached HEAD', () => {
      const mockOutput = `worktree /Users/test/my-project
HEAD abc1234
detached`;

      vi.mocked(execSync).mockReturnValue(mockOutput);

      const result = listGitWorktrees('/Users/test/my-project');

      expect(result).toHaveLength(1);
      expect(result[0].branch).toBe('detached@abc1234');
    });

    it('handles slashes in branch names', () => {
      const mockOutput = `worktree /Users/test/my-project
HEAD abc1234
branch refs/heads/feature/user-auth/login`;

      vi.mocked(execSync).mockReturnValue(mockOutput);

      const result = listGitWorktrees('/Users/test/my-project');

      expect(result[0].branch).toBe('feature/user-auth/login');
    });

    it('returns an empty array when git fails', () => {
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error('Not a git repository');
      });

      const result = listGitWorktrees('/not/a/repo');

      expect(result).toEqual([]);
    });

    it('returns an empty array on timeout', () => {
      vi.mocked(execSync).mockImplementation(() => {
        const error = new Error('Command timeout') as any;
        error.killed = true;
        throw error;
      });

      const result = listGitWorktrees('/slow/repo');

      expect(result).toEqual([]);
    });

    it('handles empty output', () => {
      vi.mocked(execSync).mockReturnValue('');

      const result = listGitWorktrees('/repo');

      expect(result).toEqual([]);
    });

    it('handles whitespace-only output', () => {
      vi.mocked(execSync).mockReturnValue('   \n\n  ');

      const result = listGitWorktrees('/repo');

      expect(result).toEqual([]);
    });

    it('truncates the commit hash to 7 characters', () => {
      const mockOutput = `worktree /Users/test/my-project
HEAD abcdefghijklmnop
branch refs/heads/main`;

      vi.mocked(execSync).mockReturnValue(mockOutput);

      const result = listGitWorktrees('/Users/test/my-project');

      expect(result[0].commit).toBe('abcdefg');
    });

    it('normalizes paths', () => {
      const mockOutput = `worktree /Users/test/../test/./my-project
HEAD abc1234
branch refs/heads/main`;

      vi.mocked(execSync).mockReturnValue(mockOutput);

      const result = listGitWorktrees('/Users/test/my-project');

      // path.normalize should normalize the path
      expect(result[0].path).toBe(path.normalize('/Users/test/../test/./my-project'));
    });
  });

  describe('createGitWorktree', () => {
    it('creates a worktree for a new branch', () => {
      // Mock branch existence check (branch doesn't exist)
      vi.mocked(execSync)
        .mockImplementationOnce(() => {
          throw new Error('Branch not found');
        })
        // Mock worktree creation
        .mockReturnValueOnce('');

      const result = createGitWorktree(
        '/Users/test/my-project',
        '/Users/test/my-project-feat',
        'feat/new-feature'
      );

      expect(execSync).toHaveBeenCalledTimes(2);
      expect(execSync).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('git worktree add -b "feat/new-feature"'),
        expect.any(Object)
      );

      expect(result.branch).toBe('feat/new-feature');
      expect(result.isMain).toBe(false);
    });

    it('creates a worktree for an existing branch', () => {
      // Mock branch existence check (branch exists)
      vi.mocked(execSync)
        .mockReturnValueOnce('')
        // Mock worktree creation
        .mockReturnValueOnce('');

      const result = createGitWorktree(
        '/Users/test/my-project',
        '/Users/test/my-project-feat',
        'existing-branch'
      );

      // Check that the worktree creation command doesn't include -b flag
      expect(execSync).toHaveBeenNthCalledWith(
        2,
        expect.not.stringContaining('-b "existing-branch"'),
        expect.any(Object)
      );

      // Verify it's the correct command format
      expect(execSync).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('git worktree add "/Users/test/my-project-feat" "existing-branch"'),
        expect.any(Object)
      );
    });

    it('handles relative paths', () => {
      vi.mocked(execSync)
        .mockImplementationOnce(() => {
          throw new Error('Branch not found');
        })
        .mockReturnValueOnce('');

      const result = createGitWorktree(
        '/Users/test/my-project',
        '../my-project-feat',
        'feat/new-feature'
      );

      // Should resolve to absolute path
      expect(result.path).toBe(path.normalize('/Users/test/my-project-feat'));
    });

    it('throws when worktree creation fails', () => {
      vi.mocked(execSync)
        .mockImplementationOnce(() => {
          throw new Error('Branch not found');
        })
        .mockImplementationOnce(() => {
          throw new Error('Worktree creation failed');
        });

      expect(() => {
        createGitWorktree(
          '/Users/test/my-project',
          '/Users/test/my-project-feat',
          'feat/new-feature'
        );
      }).toThrow('Worktree creation failed');
    });

    it('handles errors when the branch check times out', () => {
      vi.mocked(execSync).mockImplementation(() => {
        const error = new Error('Command timeout') as any;
        error.killed = true;
        throw error;
      });

      // Should treat timeout as "branch doesn't exist" and proceed
      expect(() => {
        createGitWorktree(
          '/Users/test/my-project',
          '/Users/test/my-project-feat',
          'feat/new-feature'
        );
      }).toThrow();
    });

    it('handles special characters in branch names', () => {
      vi.mocked(execSync)
        .mockImplementationOnce(() => {
          throw new Error('Branch not found');
        })
        .mockReturnValueOnce('');

      createGitWorktree(
        '/Users/test/my-project',
        '/Users/test/my-project-feat',
        'feat/JIRA-123_fix-bug'
      );

      expect(execSync).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('feat/JIRA-123_fix-bug'),
        expect.any(Object)
      );
    });

    it('handles paths with spaces', () => {
      vi.mocked(execSync)
        .mockImplementationOnce(() => {
          throw new Error('Branch not found');
        })
        .mockReturnValueOnce('');

      createGitWorktree(
        '/Users/test/my project',
        '/Users/test/my project feat',
        'feat/new-feature'
      );

      expect(execSync).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('"/Users/test/my project feat"'),
        expect.any(Object)
      );
    });
  });

  describe('edge cases', () => {
    it('handles very long branch names', () => {
      const longBranch = 'feature/'.repeat(10) + 'new-feature';
      const mockOutput = `worktree /Users/test/my-project
HEAD abc1234
branch refs/heads/${longBranch}`;

      vi.mocked(execSync).mockReturnValue(mockOutput);

      const result = listGitWorktrees('/Users/test/my-project');

      expect(result[0].branch).toBe(longBranch);
    });

    it('handles unicode characters in paths', () => {
      const mockOutput = `worktree /Users/测试/my-project-功能
HEAD abc1234
branch refs/heads/main`;

      vi.mocked(execSync).mockReturnValue(mockOutput);

      const result = listGitWorktrees('/Users/测试/my-project-功能');

      expect(result[0].path).toContain('测试');
      expect(result[0].path).toContain('功能');
    });

    it('handles multiple consecutive blank lines', () => {
      const mockOutput = `worktree /Users/test/my-project
HEAD abc1234
branch refs/heads/main


worktree /Users/test/my-project-feat
HEAD def5678
branch refs/heads/feat`;

      vi.mocked(execSync).mockReturnValue(mockOutput);

      const result = listGitWorktrees('/Users/test/my-project');

      expect(result).toHaveLength(2);
    });
  });
});
