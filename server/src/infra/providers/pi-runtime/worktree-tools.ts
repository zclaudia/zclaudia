import type { AgentTool } from '@earendil-works/pi-agent-core';
import type Database from 'better-sqlite3';
import * as path from 'path';

import {
  cleanupAgentWorktree,
  createSessionWorktree,
  isGitRepository,
  SESSION_WORKTREES_DIR,
  worktreeBranch,
} from '../../../utils/agent-worktrees.js';
import { listGitWorktrees } from '../../../utils/git-worktrees.js';
import { errorResult, textResult, toolParams } from './tool-common.js';

export interface WorktreeToolOptions {
  db?: Database.Database;
  sessionId?: string;
}

function persistWorkingDirectory(db: Database.Database, sessionId: string, dir: string | null): void {
  db.prepare('UPDATE sessions SET working_directory = ?, updated_at = ? WHERE id = ?').run(dir, Date.now(), sessionId);
}

function isUnderSessionWorktrees(cwd: string): boolean {
  const marker = `${path.sep}${SESSION_WORKTREES_DIR}${path.sep}`;
  return path.resolve(cwd).includes(marker);
}

function mainWorktreePath(cwd: string): string | undefined {
  return listGitWorktrees(cwd).find(wt => wt.isMain)?.path;
}

export function createEnterWorktreeTool(cwd: string, options?: WorktreeToolOptions): AgentTool<any> {
  return {
    name: 'EnterWorktree',
    label: 'EnterWorktree',
    description: 'Create an isolated git worktree and switch the session to it, so your changes stay on a separate branch. Takes effect on your NEXT turn (the current turn keeps the existing working directory). Use when you want to work on a change in isolation before merging.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Short name for the worktree/branch (e.g. "refactor-auth")' },
      },
      required: ['name'],
    } as any,
    execute: async (toolCallId: string, params: unknown) => {
      const args = toolParams(toolCallId, params);
      const db = options?.db;
      const sessionId = options?.sessionId;
      if (!db || !sessionId) return errorResult('missing_session_context', 'EnterWorktree requires session context');
      if (typeof args.name !== 'string' || !args.name.trim()) {
        return errorResult('missing_name', 'EnterWorktree requires a name');
      }
      if (isUnderSessionWorktrees(cwd)) {
        return errorResult('already_in_worktree', 'This session is already in a worktree. Use ExitWorktree before entering another.');
      }
      if (!isGitRepository(cwd)) {
        return errorResult('not_a_git_repo', `Cannot create a worktree: ${cwd} is not a git repository.`);
      }
      try {
        const wt = createSessionWorktree(cwd, args.name.trim());
        persistWorkingDirectory(db, sessionId, wt.path);
        return textResult(
          `Created worktree on branch ${wt.branch} at ${wt.path}. It becomes your working directory on the next turn - `
            + 'finish this turn, then continue your work there. Use ExitWorktree when done.',
          { ok: true, path: wt.path, branch: wt.branch },
        );
      } catch (err) {
        return errorResult('enter_worktree_failed', err instanceof Error ? err.message : String(err));
      }
    },
  } as unknown as AgentTool<any>;
}

export function createExitWorktreeTool(cwd: string, options?: WorktreeToolOptions): AgentTool<any> {
  return {
    name: 'ExitWorktree',
    label: 'ExitWorktree',
    description: 'Leave the current git worktree and switch the session back to the project root (takes effect next turn). action:"remove" also deletes the worktree if it has no uncommitted changes or unique commits; action:"keep" (default) leaves it in place for later.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['keep', 'remove'], default: 'keep' },
      },
    } as any,
    execute: async (toolCallId: string, params: unknown) => {
      const args = toolParams(toolCallId, params);
      const db = options?.db;
      const sessionId = options?.sessionId;
      if (!db || !sessionId) return errorResult('missing_session_context', 'ExitWorktree requires session context');
      if (!isUnderSessionWorktrees(cwd)) {
        return errorResult('not_in_worktree', 'This session is not currently in a worktree.');
      }
      const rootPath = mainWorktreePath(cwd);
      if (!rootPath) {
        return errorResult('main_worktree_not_found', 'Could not locate the main worktree to return to.');
      }
      persistWorkingDirectory(db, sessionId, rootPath);
      let removed = false;
      let keptReason: string | undefined;
      if (args.action === 'remove') {
        const branch = worktreeBranch(cwd);
        const cleanup = cleanupAgentWorktree(rootPath, { path: cwd, branch: branch ?? '' });
        removed = cleanup.removed;
        if (!removed) keptReason = cleanup.reason;
      }
      const base = `Switched back to ${rootPath} (effective next turn).`;
      const tail = args.action === 'remove'
        ? removed
          ? ' The worktree was removed.'
          : ` The worktree was kept (${keptReason === 'has_commits' ? 'it has commits' : keptReason === 'has_changes' ? 'it has uncommitted changes' : 'could not be removed'}).`
        : ' The worktree was left in place.';
      return textResult(base + tail, { ok: true, removed, ...(keptReason ? { keptReason } : {}) });
    },
  } as unknown as AgentTool<any>;
}
