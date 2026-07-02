// Review-prompt construction for AI code review of a local PR. Extracted from
// LocalPRService so prompt building is a cohesive, side-effect-scoped unit (QA-0034),
// mirroring conflict-resolution-prompt.ts.
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import type { LocalPR } from './types.js';

const INLINE_DIFF_MAX_CHARS = 12000;
const DIFF_PREVIEW_CHARS = 3000;

/**
 * Builds the code-review prompt for a PR. When the diff is too large to inline it is
 * written into the worktree and referenced by path, matching the previous behaviour.
 */
export async function buildReviewPrompt(pr: LocalPR): Promise<string> {
  const diff = pr.diffSummary ?? '(no diff available)';
  let diffSection: string;

  if (diff.length <= INLINE_DIFF_MAX_CHARS) {
    diffSection = `## Diff
\`\`\`diff
${diff}
\`\`\``;
  } else {
    const relPath = path.join('.zclaudia', 'local-pr-review', `${pr.id}.diff.patch`);
    const absPath = path.join(pr.worktreePath, relPath);
    try {
      await mkdir(path.dirname(absPath), { recursive: true });
      await writeFile(absPath, diff, 'utf8');
      diffSection = `## Diff
Diff is too large to inline (${diff.length} chars). Read it from:
\`${relPath}\`

Preview:
\`\`\`diff
${diff.slice(0, DIFF_PREVIEW_CHARS)}
\n... [truncated preview]
\`\`\``;
    } catch {
      diffSection = `## Diff
\`\`\`diff
${diff.slice(0, INLINE_DIFF_MAX_CHARS)}
\n... [truncated]
\`\`\``;
    }
  }

  return `You are a code reviewer. Your job is to review the following diff, fix any issues directly in the files, commit your fixes, and output a review verdict.

## Branch
\`${pr.branchName}\` → \`${pr.baseBranch}\`

${diffSection}

## Instructions
1. Review the diff for bugs, security issues, code quality problems, or missing error handling.
2. If you find issues, fix them directly in the files in the working directory.
3. After fixing, commit your changes with: git add -A && git commit -m "fix: review fixes for ${pr.branchName}"
4. At the end of your response, output ONE of:
   - [REVIEW_PASSED] — if no issues found (or all issues were fixed)
   - [REVIEW_FAILED] — only if you found critical issues you could NOT fix

Be thorough but pragmatic. Minor style issues do not warrant REVIEW_FAILED.`;
}
