import { describe, it, expect, vi } from 'vitest';

const mockExecFile = vi.fn();
vi.mock('child_process', () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
}));

import { GenerateCommitMessageActivity } from '../generate-commit-message.js';
import type { ActivityServices } from '../../types.js';

type ExecFileCallback = (error: Error | null, result: { stdout: string; stderr?: string }) => void;

function mockGitSequence(outputs: string[]) {
  let i = 0;
  mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: ExecFileCallback) => {
    cb(null, { stdout: outputs[i++] ?? '' });
  });
}

function servicesWith(run: ActivityServices['agentLoopRunner']['run']): ActivityServices {
  return { agentLoopRunner: { run } };
}

describe('GenerateCommitMessageActivity', () => {
  it('builds a conventional message from subject + body', async () => {
    mockGitSequence([
      'diff --git a/a.ts b/a.ts\n+x', // diff --cached
      ' a.ts | 1 +',                  // diff --cached --stat
      'a.ts\n',                       // diff --cached --name-only
    ]);
    const run = vi.fn(async () => ({
      status: 'completed' as const,
      output: { subject: 'feat(git): add x', body: 'Adds the x thing.' },
    }));
    const activity = new GenerateCommitMessageActivity();
    const res = await activity.invoke({ worktreePath: '/repo' }, servicesWith(run));
    expect(res.status).toBe('completed');
    expect(res.output.message).toBe('feat(git): add x\n\nAdds the x thing.');
    const req = run.mock.calls[0][0];
    expect(req.toolset).toEqual({ id: 'none' });
    expect(req.outputContract.schema.required).toEqual(['subject']);
  });

  it('omits the body when the model returns none', async () => {
    mockGitSequence(['d', ' a.ts | 1 +', 'a.ts\n']);
    const run = vi.fn(async () => ({ status: 'completed' as const, output: { subject: 'fix: y' } }));
    const res = await new GenerateCommitMessageActivity().invoke({ worktreePath: '/repo' }, servicesWith(run));
    expect(res.output.message).toBe('fix: y');
  });

  it('fails when nothing is staged (and does not call the model)', async () => {
    mockGitSequence(['', '', '']);
    const run = vi.fn();
    const res = await new GenerateCommitMessageActivity().invoke({ worktreePath: '/repo' }, servicesWith(run));
    expect(res.status).toBe('failed');
    expect(res.error).toBe('No staged changes');
    expect(run).not.toHaveBeenCalled();
  });

  it('fails when the model run does not complete', async () => {
    mockGitSequence(['d', ' a.ts | 1 +', 'a.ts\n']);
    const run = vi.fn(async () => ({ status: 'timeout' as const, output: {}, error: 'too slow' }));
    const res = await new GenerateCommitMessageActivity().invoke({ worktreePath: '/repo' }, servicesWith(run));
    expect(res.status).toBe('failed');
    expect(res.error).toBe('too slow');
  });

  it('returns a failed result when git throws (not a throw)', async () => {
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: ExecFileCallback) => {
      cb(new Error('not a git repository'), { stdout: '' });
    });
    const run = vi.fn();
    const res = await new GenerateCommitMessageActivity().invoke({ worktreePath: '/repo' }, servicesWith(run));
    expect(res.status).toBe('failed');
    expect(res.error).toContain('not a git repository');
    expect(run).not.toHaveBeenCalled();
  });
});
