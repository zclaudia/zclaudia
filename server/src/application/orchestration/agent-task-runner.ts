import type Database from 'better-sqlite3';
import type { ServerMessage } from '@zclaudia/shared/wire/messages';
import { newId } from '../../utils/uuid.js';
import {
  createAgentWorktree,
  cleanupAgentWorktree,
  isGitRepository,
  type AgentWorktree,
} from '../../utils/agent-worktrees.js';
import { ClaudiaBranchService } from './claudia-branch-service.js';

const VIRTUAL_CLIENT_TIMEOUT_MS = 30 * 60 * 1000;

export interface VirtualClient {
  readonly id: string;
}

export interface AgentRunnerTask {
  id: string;
  parentTaskId: string | null;
  projectId: string | null;
  sessionId: string | null;
  branchId: string | null;
  contextTemplate: string;
  status: string;
  task: string;
  externalId: string | null;
  canonicalTaskId?: string;
  initiator: 'system' | 'claudia';
  llmProfileId?: string;
  permissionOverride?: Partial<
    import('@zclaudia/shared/interaction/permissions').UnifiedPermissionPolicy
  >;
  /** Parent workspace root; the subagent runs here unless isolated. */
  cwd?: string | null;
  /** 'worktree': run in an ephemeral git worktree of cwd (removed when clean). */
  isolation?: 'worktree' | null;
  retryCount: number;
  maxRetries: number;
  createdAt: number;
  updatedAt: number;
}

export interface AgentTaskRunnerDeps {
  db: Database.Database;
  createVirtualClient: (
    clientId: string,
    ws: { send: (msg: ServerMessage) => void }
  ) => VirtualClient;

  handleRunStart: (
    client: VirtualClient,
    message: any,
    db: Database.Database,
    options?: Record<string, unknown>,
    clients?: Map<string, VirtualClient>
  ) => Promise<void>;
  getClients: () => Map<string, VirtualClient>;
  createSession: (opts: { projectId: string | null; name: string; type: string }) => { id: string };
  sessionExists: (id: string) => boolean;
}

export interface AgentTaskRunCallbacks {
  onStarted: (sessionId: string) => void;
  onDelta?: (content: string) => void;
  onCompleted: (result: { resultSummary: string; responseText: string; toolCount: number }) => void;
  onFailed: (errorSummary: string) => void;
}

export interface AgentTaskRunner {
  run(task: AgentRunnerTask, callbacks: AgentTaskRunCallbacks): void;
}

export function createAgentTaskRunner(deps: AgentTaskRunnerDeps): AgentTaskRunner {
  const branchService = new ClaudiaBranchService(deps.db);

  function resolveSession(task: AgentRunnerTask): string {
    const sessionName = `Agent Task: ${task.task.slice(0, 50)}`;
    if (task.branchId) {
      const branch = branchService.findById(task.branchId);
      const existingSession = branch?.activeSessionId
        ? deps.sessionExists(branch.activeSessionId)
        : false;
      if (branch?.activeSessionId && existingSession) {
        return branch.activeSessionId;
      }
      const session = deps.createSession({
        projectId: task.projectId,
        name: sessionName,
        type: 'agent',
      });
      branchService.attachSession(task.branchId, session.id);
      return session.id;
    }
    return deps.createSession({ projectId: task.projectId, name: sessionName, type: 'agent' }).id;
  }

  return {
    run(task, callbacks) {
      const sessionId = resolveSession(task);
      callbacks.onStarted(sessionId);

      // Worktree isolation: the subagent gets its own ephemeral checkout so
      // parallel agents never trample each other's files. Falls back to the
      // parent cwd when the workspace is not a git repo or creation fails.
      let agentWorktree: AgentWorktree | undefined;
      let workingDirectory = task.cwd ?? undefined;
      if (task.isolation === 'worktree' && task.cwd) {
        if (isGitRepository(task.cwd)) {
          try {
            agentWorktree = createAgentWorktree(task.cwd, task.id);
            workingDirectory = agentWorktree.path;
          } catch (err) {
            console.warn(
              `[AgentTaskRunner] worktree isolation failed for task ${task.id}; running in place:`,
              err
            );
          }
        } else {
          console.warn(
            `[AgentTaskRunner] task ${task.id} requested worktree isolation but ${task.cwd} is not a git repository`
          );
        }
      }

      /** Idempotent; returns a note when the worktree is kept because it has work in it. */
      function settleWorktree(): string | undefined {
        if (!agentWorktree || !task.cwd) return undefined;
        const worktree = agentWorktree;
        agentWorktree = undefined;
        const cleanup = cleanupAgentWorktree(task.cwd, worktree);
        if (cleanup.removed) return undefined;
        if (cleanup.reason === 'error') {
          console.warn(
            `[AgentTaskRunner] failed to clean up worktree ${worktree.path} for task ${task.id}`
          );
          return undefined;
        }
        return `Worktree kept at ${worktree.path} (branch ${worktree.branch}) — it contains the agent's ${
          cleanup.reason === 'has_commits' ? 'commits' : 'uncommitted changes'
        }.`;
      }

      const clientId = `orchestrator-${task.id}`;
      const clients = deps.getClients();
      let settled = false;

      function cleanupVirtualClient() {
        if (settled) return;
        settled = true;
        clearTimeout(safetyTimer);
        clients.delete(clientId);
      }

      const safetyTimer = setTimeout(() => {
        if (!settled) {
          console.warn(`[AgentTaskRunner] Virtual client timeout for task ${task.id}`);
          cleanupVirtualClient();
          settleWorktree();
          callbacks.onFailed('Task timed out (30 minutes)');
        }
      }, VIRTUAL_CLIENT_TIMEOUT_MS);

      let fullContent = '';
      let toolCount = 0;

      const virtualClient = deps.createVirtualClient(clientId, {
        send: (msg: ServerMessage) => {
          try {
            if (msg.type === 'delta') {
              const text = (msg as { content?: string }).content || '';
              fullContent += text;
              callbacks.onDelta?.(text);
            } else if (msg.type === 'tool_use') {
              toolCount++;
            } else if (msg.type === 'run_completed') {
              cleanupVirtualClient();
              const worktreeNote = settleWorktree();
              const stripped = fullContent.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
              const summary = stripped.slice(0, 200) || 'Task completed';
              callbacks.onCompleted({
                resultSummary: worktreeNote ? `${summary}\n${worktreeNote}` : summary,
                responseText: worktreeNote ? `${fullContent}\n\n[${worktreeNote}]` : fullContent,
                toolCount,
              });
            } else if (msg.type === 'run_failed') {
              cleanupVirtualClient();
              const worktreeNote = settleWorktree();
              const baseError = (msg as { error?: string }).error || 'Task failed';
              callbacks.onFailed(worktreeNote ? `${baseError} (${worktreeNote})` : baseError);
            }
          } catch (err) {
            console.error(
              `[AgentTaskRunner] Error in virtual client send for task ${task.id}:`,
              err
            );
          }
        },
      });

      clients.set(clientId, virtualClient);
      deps
        .handleRunStart(
          virtualClient,
          {
            type: 'run_start',
            clientRequestId: newId(),
            sessionId,
            input: task.task,
            llmProfileId: task.llmProfileId,
            permissionOverride: task.permissionOverride,
            ...(workingDirectory ? { workingDirectory } : {}),
            _contextTemplate: task.contextTemplate || 'agent',
          },
          deps.db,
          {},
          clients
        )
        .catch((err: unknown) => {
          cleanupVirtualClient();
          settleWorktree();
          callbacks.onFailed(err instanceof Error ? err.message : 'Failed to start task');
        });
    },
  };
}
