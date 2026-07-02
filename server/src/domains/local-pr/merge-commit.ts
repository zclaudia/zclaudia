// Locates the merge commit produced for a local PR. Extracted from LocalPRService so the
// git-log parsing is a pure, injectable, independently testable unit (QA-0034).
import type { LocalPR } from '@zclaudia/shared/features/local-pr';

type ExecFileAsync = (
  file: string,
  args: string[],
  options: { cwd: string }
) => Promise<{ stdout: string | Buffer }>;

/**
 * Returns the SHA of the merge commit for a PR. Uses the PR's recorded mergeCommitSha when
 * present, otherwise scans recent merge commits for the one whose subject matches the PR.
 */
export async function resolveMergeCommitSha(
  pr: LocalPR,
  repoPath: string,
  execFileAsync: ExecFileAsync
): Promise<string | null> {
  if (pr.mergeCommitSha) return pr.mergeCommitSha;
  const { stdout } = await execFileAsync(
    'git',
    ['log', '--merges', '--format=%H%x1f%s', '-n', '200'],
    { cwd: repoPath }
  );
  const expectedSubject = `Merge Local PR: ${pr.title}`;
  const output = String(stdout);
  const row = output
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => line.split('\x1f'))
    .find(parts => parts[1] === expectedSubject);
  return row?.[0] ?? null;
}
