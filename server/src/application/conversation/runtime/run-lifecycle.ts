import { execFile } from 'child_process';
import { promisify } from 'util';
import { newId } from '../../../utils/uuid.js';
import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { Usage } from '@earendil-works/pi-ai';
import type { Request as CorrelatedRequest } from '@zclaudia/shared/wire/correlation';
import { isRequest } from '@zclaudia/shared/wire/correlation';
import type { ProviderRegistryPort } from '../../../infra/providers/registry.js';
import { interactionDispatcher } from '../interactions/interaction-dispatcher.js';
import {
  extractAndIndexMetadata,
  removeIndexedMetadata,
} from '../../../infra/storage/metadata-extractor.js';
import { broadcastRunMessage, sendMessage } from '../transport/broadcast.js';
import type { ConnectedClient, ActiveRun } from '../transport/types.js';
import { setPhase, isTerminalPhase } from './active-run-phase.js';
import {
  appendMessagesToTree,
  buildAssistantTurnMessages,
} from '../../../infra/providers/pi-runtime/session-tree/write-path.js';

/**
 * Extract a plain-text string from an AgentMessage's content field, handling
 * both string and ContentBlock[] shapes (UserMessage). Returns undefined when
 * no text content can be recovered (non-user variants, image-only blocks, etc).
 */
function extractTextContent(message: AgentMessage): string | undefined {
  // Only user messages carry steerable text. AgentMessage is a discriminated
  // union — narrow defensively so we don't accidentally read .content off
  // variants where it has a different shape.
  if (!('role' in message) || message.role !== 'user') return undefined;
  const content = (message as { content?: unknown }).content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const texts = content
      .filter(
        (c): c is { type: 'text'; text: string } =>
          !!c &&
          typeof c === 'object' &&
          (c as { type?: unknown }).type === 'text' &&
          typeof (c as { text?: unknown }).text === 'string'
      )
      .map(c => c.text);
    return texts.length > 0 ? texts.join('') : undefined;
  }
  return undefined;
}

const execFileAsync = promisify(execFile);

// --- Process PID scanning ---

function buildTaskCommandNeedles(taskCommand?: string): string[] {
  if (!taskCommand) return [];
  const trimmed = taskCommand.trim();
  if (!trimmed) return [];

  const needles = new Set<string>([trimmed.slice(0, 200)]);
  const firstSegment = trimmed.split(/\s*(?:&&|\|\||;|\|)\s*/)[0]?.trim();
  if (firstSegment && firstSegment.length >= 4) {
    needles.add(firstSegment.slice(0, 120));
  }
  return [...needles];
}

export async function findProcessPidsByTaskCommand(
  taskCommand?: string,
  excludedPids: number[] = []
): Promise<number[]> {
  const needles = buildTaskCommandNeedles(taskCommand);
  if (needles.length === 0) return [];

  try {
    const { stdout } = await execFileAsync('ps', ['-e', '-o', 'pid=,comm=,args=']);
    const excluded = new Set<number>([process.pid, ...excludedPids]);
    return stdout
      .trim()
      .split('\n')
      .map(line => line.trim())
      .map(line => {
        const match = line.match(/^(\d+)\s+(\S+)\s+(.*)$/);
        if (!match) return null;
        return {
          pid: Number(match[1]),
          args: match[3],
        };
      })
      .filter((proc): proc is { pid: number; args: string } => proc !== null)
      .filter(proc => !excluded.has(proc.pid))
      .filter(proc => needles.some(needle => proc.args.includes(needle)))
      .filter(proc => {
        const args = proc.args.toLowerCase();
        if (
          args.includes('/opt/homebrew/bin/claude ') ||
          args.includes(' claude --output-format stream-json')
        ) {
          return false;
        }
        if (args.includes('mcp-bridge.js') || args.includes('claudia-plugins')) {
          return false;
        }
        return true;
      })
      .map(proc => proc.pid);
  } catch (err) {
    console.warn('[Task PID] Failed to scan processes by command:', err);
    return [];
  }
}

// --- Run cancellation ---

export interface CancelRunContext {
  activeRuns: Map<string, ActiveRun>;
  processMonitor: { check: () => void } | null;
  broadcastHeartbeat: () => void;
  providerRegistry: ProviderRegistryPort;
}

export interface CancelRunOptions {
  clientError?: string;
  logLabel?: string;
}

export function cleanupPendingPermissions(run: ActiveRun, message = 'Run cancelled'): void {
  run.pendingPermissions.forEach(({ resolve, timeout }) => {
    if (timeout) clearTimeout(timeout);
    resolve({ behavior: 'deny', message });
  });
  run.pendingPermissions.clear();
}

export function cancelRun(
  runId: string,
  ctx: CancelRunContext,
  options: CancelRunOptions = {}
): void {
  const run = ctx.activeRuns.get(runId);
  if (run) {
    // Race guard: if the run already terminated before cancel arrived,
    // skip cleanup — there's nothing left to abort and emitting phase
    // transitions from a terminal state would warn.
    if (isTerminalPhase(run.phase)) {
      ctx.activeRuns.delete(runId);
      ctx.broadcastHeartbeat();
      return;
    }

    // Mark the cancel-in-flight phase before any cleanup work.
    setPhase(run, 'cancelling');

    // Stop periodic save
    if (run.saveInterval) {
      clearInterval(run.saveInterval);
      run.saveInterval = undefined;
    }

    // Reject all pending permissions
    cleanupPendingPermissions(run, 'Run cancelled');

    // Abort the active provider stream immediately even before a provider-level
    // session ID is known. This is the primary cleanup path for provider runs.
    if (run.abortController && !run.abortController.signal.aborted) {
      run.abortController.abort();
    }

    // Abort provider session if applicable
    if (run.providerSessionId && run.providerCwd && run.providerType) {
      const adapter = ctx.providerRegistry.get(run.providerType);
      adapter?.abort?.(run.providerSessionId, run.providerCwd).catch(err => {
        console.error(`Failed to abort provider session: ${err}`);
      });
    }

    // Save accumulated content before discarding the run
    try {
      upsertAssistantMessage(run, { indexMetadata: true });
      if (run.fullContent) {
        console.log(
          `[Cancel] Saved partial assistant message for run ${runId} (${run.fullContent.length} chars)`
        );
      }
    } catch (err) {
      console.error(`[Cancel] Failed to save partial message for run ${runId}:`, err);
      setPhase(run, 'failed');
    }

    // If the user queued any mid-run steers that pi hadn't yet drained, hand
    // them back as a single restorable draft so the client can repopulate the
    // input box. join('\n\n') matches what a user typing the same text across
    // multiple sends would visually look like.
    const restoreDraft =
      run.pendingSteers && run.pendingSteers.length > 0
        ? (() => {
            const joined = run.pendingSteers
              .map(m => extractTextContent(m))
              .filter((t): t is string => Boolean(t))
              .join('\n\n');
            return joined.length > 0 ? joined : undefined;
          })()
        : undefined;

    // Broadcast run_failed to ALL connected clients so every device updates its UI.
    run.eventSeq += 1;
    broadcastRunMessage(run, {
      type: 'run_failed',
      runId,
      sessionId: run.sessionId,
      error: options.clientError ?? 'Run cancelled by user',
      seq: run.eventSeq,
      ...(restoreDraft ? { restoreDraft } : {}),
    });

    // Clear steer state — handle.steer on an aborted agent is no longer safe,
    // and pendingSteers is now the client's responsibility (via restoreDraft).
    run.pendingSteers = [];
    run.steerHandle = undefined;

    interactionDispatcher.cancelBySession(run.sessionId);

    // Cleanup finished. Only set 'cancelled' if we're still in 'cancelling'
    // (the catch above may have already set 'failed').
    if (run.phase === 'cancelling') {
      setPhase(run, 'cancelled');
    }

    ctx.activeRuns.delete(runId);
    ctx.broadcastHeartbeat();
    console.log(`${options.logLabel ?? 'Run'} ${runId} cancelled`);

    // Trigger deferred leak check after cancel
    if (ctx.processMonitor && ctx.activeRuns.size === 0) {
      setTimeout(() => ctx.processMonitor?.check(), 5_000);
    }
  }
}

// --- Message persistence ---

/**
 * Get the next sequential offset for a message in a session.
 */
export function getNextOffset(db: import('better-sqlite3').Database, sessionId: string): number {
  const row = db
    .prepare('SELECT COALESCE(MAX(offset), 0) + 1 as next FROM messages WHERE session_id = ?')
    .get(sessionId) as { next: number };
  return row.next;
}

/**
 * Upsert assistant message to database.
 * Uses INSERT ... ON CONFLICT to avoid duplicates — safe to call multiple times
 * with the same assistantMessageId (periodic saves, cancel saves, final save).
 */
export function upsertAssistantMessage(
  run: ActiveRun,
  options?: { usage?: Usage; indexMetadata?: boolean }
): void {
  const metadata: Record<string, unknown> = {};
  if (options?.usage) {
    metadata.usage = options.usage;
  }
  if (run.collectedToolCalls.length > 0) {
    metadata.toolCalls = run.collectedToolCalls.map(
      ({ toolUseId, name, input, output, isError, effect }) => ({
        toolUseId,
        name,
        input,
        output,
        isError,
        effect,
      })
    );
  }
  if (run.contentBlocks.length > 0) {
    metadata.contentBlocks = run.contentBlocks;
  }
  if (run.thinkingBlocks && run.thinkingBlocks.length > 0) {
    metadata.thinkingBlocks = run.thinkingBlocks;
  }

  const hasPersistableContent =
    run.fullContent.trim().length > 0 ||
    run.collectedToolCalls.length > 0 ||
    run.contentBlocks.length > 0 ||
    (run.thinkingBlocks?.length ?? 0) > 0;

  if (!hasPersistableContent) return;

  const metadataJson = Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : null;

  const assistantOffset = getNextOffset(run.db, run.sessionId);
  // Route C: the assistant messages-table row, its derived index entries, and
  // the session-tree turn all commit together — a partial write would leave the
  // UI projection and the context truth source disagreeing. The tree append
  // happens exactly once (run.treeTurnAppended), but the flag is only set AFTER
  // the transaction commits so a rollback-then-retry re-appends rather than
  // silently skipping. (appendMessagesToTree's own transaction nests as a savepoint.)
  const willAppendTree = Boolean(options?.indexMetadata) && !run.treeTurnAppended;
  run.db.transaction(() => {
    run.db
      .prepare(
        `
      INSERT INTO messages (id, session_id, role, content, metadata, created_at, offset)
      VALUES (?, ?, 'assistant', ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        content = excluded.content,
        metadata = excluded.metadata
    `
      )
      .run(
        run.assistantMessageId,
        run.sessionId,
        run.fullContent,
        metadataJson,
        Date.now(),
        assistantOffset
      );

    // Extended indexing (file_references, tool_call_records) — only on final/cancel save
    if (options?.indexMetadata && metadataJson) {
      const row = run.db
        .prepare('SELECT rowid FROM messages WHERE id = ?')
        .get(run.assistantMessageId) as { rowid: number } | undefined;
      if (row) {
        // Clean previous index entries then re-extract
        removeIndexedMetadata(run.db, run.assistantMessageId);
        extractAndIndexMetadata(
          run.db,
          run.assistantMessageId,
          row.rowid,
          run.sessionId,
          metadata as Parameters<typeof extractAndIndexMetadata>[4],
          Date.now()
        );
      }
    }

    if (willAppendTree) {
      const entryIds = appendMessagesToTree(
        run.db,
        run.sessionId,
        buildAssistantTurnMessages({
          fullContent: run.fullContent,
          thinkingBlocks: run.thinkingBlocks,
          collectedToolCalls: run.collectedToolCalls,
          usage: options?.usage,
        })
      );
      run.db
        .prepare(`UPDATE messages SET tree_entry_id = ? WHERE id = ?`)
        .run(entryIds[0], run.assistantMessageId);
    }
  })();
  if (willAppendTree) run.treeTurnAppended = true;
}

// --- Message parsing ---

/**
 * Parse incoming message - supports both old and new formats
 * This enables backward compatibility during migration to correlation protocol.
 *
 * Old format: { type: 'get_projects', ... }
 * New format: { id: '...', type: 'projects.list.request', payload: {...}, ... }
 *
 * Old messages are wrapped in a Request envelope for consistent handling.
 */
export function parseMessage(data: string): { request: CorrelatedRequest; isOldFormat: boolean } {
  const parsed = JSON.parse(data);

  // Check if already in new correlation format
  if (isRequest(parsed)) {
    return { request: parsed, isOldFormat: false };
  }

  // Old format - wrap in Request envelope
  const request: CorrelatedRequest = {
    id: newId(),
    type: parsed.type,
    payload: parsed,
    timestamp: Date.now(),
    metadata: {
      timeout: 30000,
      requiresAuth: false,
    },
  };

  return { request, isOldFormat: true };
}
