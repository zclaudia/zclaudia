import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExecFile = vi.fn();
vi.mock('child_process', () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
}));

import { GitCommitActivity } from '../git-commit.js';
import type { ActivityServices } from '../../types.js';

type ExecFileCallback = (error: Error | null, result: { stdout: string; stderr?: string }) => void;
const services = { agentLoopRunner: {} as never } as ActivityServices;

function mockGitByArgs(map: (args: string[]) => string) {
  mockExecFile.mockImplementation((_cmd: string, args: string[], _opts: unknown, cb: ExecFileCallback) => {
    cb(null, { stdout: map(args) });
  });
}

describe('GitCommitActivity', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns no-op when the tree is clean', async () => {
    mockGitByArgs((args) => (args[0] === 'status' ? '' : ''));
    const res = await new GitCommitActivity().invoke({ worktreePath: '/repo' }, services);
    expect(res.status).toBe('completed');
    expect(res.output.commitSha).toBeNull();
  });

  it('stat mode (default) builds an "auto:" message from diff --stat', async () => {
    mockGitByArgs((args) => {
      if (args[0] === 'status') return ' M a.ts';
      if (args[0] === 'diff') return ' a.ts | 2 +-\n 1 file changed, 1 insertion(+), 1 deletion(-)';
      if (args[0] === 'rev-parse') return 'abc123';
      return '';
    });
    const res = await new GitCommitActivity().invoke({ worktreePath: '/repo' }, services);
    expect(res.status).toBe('completed');
    expect(res.output.commitSha).toBe('abc123');
    expect(res.output.message).toBe('auto: 1 file changed, 1 insertion(+), 1 deletion(-)');
  });

  it('explicit mode uses the provided message', async () => {
    mockGitByArgs((args) => {
      if (args[0] === 'status') return ' M a.ts';
      if (args[0] === 'rev-parse') return 'def456';
      return '';
    });
    const res = await new GitCommitActivity().invoke(
      { worktreePath: '/repo', messageMode: 'explicit', message: 'fix: real bug' },
      services,
    );
    expect(res.output.message).toBe('fix: real bug');
    expect(res.output.commitSha).toBe('def456');
  });

  it('fails when no working directory is resolvable', async () => {
    const res = await new GitCommitActivity().invoke({}, services);
    expect(res.status).toBe('failed');
    expect(res.error).toBe('No working directory');
  });
});
