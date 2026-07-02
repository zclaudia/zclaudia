export interface ConflictResolutionPromptInput {
  branchName: string;
  baseBranch: string;
}

export function buildConflictResolutionPrompt({
  branchName,
  baseBranch,
}: ConflictResolutionPromptInput): string {
  return `You are a git expert. The branch '${branchName}' has a merge conflict when merging into '${baseBranch}'.

Your task:
1. You are in the worktree for branch '${branchName}'. Rebase onto '${baseBranch}':
   git rebase ${baseBranch}
2. Resolve any conflicts by editing the conflicted files (look for <<<<<<<, =======, >>>>>>> markers).
3. After resolving each file: git add <file>
4. Continue the rebase: git rebase --continue
5. Repeat steps 2-4 until the rebase completes.

IMPORTANT: Do NOT merge into ${baseBranch}. Only rebase this branch. The merge will be handled separately.

If the rebase succeeds, output: [CONFLICT_RESOLVED]
If you cannot resolve it, output: [CONFLICT_UNRESOLVED]`;
}
