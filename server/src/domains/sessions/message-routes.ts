import { type Router, type Request, type Response } from 'express';
import { newId } from '../../utils/uuid.js';
import type Database from 'better-sqlite3';
import type { ApiResponse } from '@zclaudia/shared/core/api';
import type {
  Message,
  MessageMetadata,
  MessageRole,
  CompactionMarker,
} from '@zclaudia/shared/core/message';
import { extractAndIndexMetadata } from '../../infra/storage/metadata-extractor.js';
import { findForegroundActiveRunIdForSession } from '../../utils/run-state.js';
import { parsePersistedMessageMetadata } from '../../utils/persisted-message.js';
import { SessionMessageRepository } from './message-repository.js';
import { listCompactions, type SessionCompaction } from './compaction-tree-read.js';
import { applyMessagePageBudget } from './message-page-budget.js';
import type { RunPhase } from '../../application/conversation/runtime/active-run-phase.js';
/** Minimal shape — avoids depending on application/conversation types */
type ActiveRunsMap = Map<string, { sessionId?: string; phase: RunPhase; sessionType?: string }>;

/**
 * Wrap a stored compaction row as a synthetic system-role Message whose
 * `metadata.compactionMarker` carries the UI payload. We use the marker's
 * own `compactionId` as the message id so the desktop dedup/merge logic
 * (which keys on `id`) treats repeat fetches idempotently.
 */
function compactionToTimelineEntry(compaction: SessionCompaction): Message {
  const marker: CompactionMarker = {
    compactionId: compaction.id,
    summary: compaction.summary,
    tokensBefore: compaction.tokensBefore,
    source: compaction.source,
    customInstructions: compaction.customInstructions ?? undefined,
    readFiles: compaction.details?.readFiles ?? [],
    modifiedFiles: compaction.details?.modifiedFiles ?? [],
    createdAt: compaction.createdAt,
  };
  return {
    id: compaction.id,
    sessionId: compaction.sessionId,
    role: 'system',
    content: '',
    metadata: { compactionMarker: marker },
    createdAt: compaction.createdAt,
  };
}

export function mountMessageRoutes(
  router: Router,
  db: Database.Database,
  activeRuns: ActiveRunsMap
): void {
  const repo = new SessionMessageRepository(db);

  router.get('/:id/messages', (req: Request, res: Response) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
      const before = req.query.before ? parseInt(req.query.before as string) : undefined;
      const after = req.query.after ? parseInt(req.query.after as string) : undefined;
      const afterOffset = req.query.afterOffset
        ? parseInt(req.query.afterOffset as string)
        : undefined;
      const aroundMessageId = req.query.aroundMessageId as string | undefined;

      let messages;
      try {
        messages = repo.listBySession(req.params.id, {
          limit,
          before,
          after,
          afterOffset,
          aroundMessageId,
        });
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('message not found:')) {
          res.status(404).json({
            success: false,
            error: { code: 'NOT_FOUND', message: 'Message not found in session' },
          });
          return;
        }
        throw error;
      }

      const { trimmed, wasTrimmed } = applyMessagePageBudget(messages);

      if (!after && afterOffset == null && !aroundMessageId) {
        trimmed.reverse();
      }

      const parsedMessages = trimmed.map(message => ({
        ...message,
        metadata: parsePersistedMessageMetadata<MessageMetadata>(message.metadata),
      }));

      // Interleave compaction markers chronologically. We only inject markers
      // whose createdAt falls within the time window of the returned page so we
      // don't surface them in an empty / out-of-band slot. For the common "no
      // filter" full-history view this becomes the entire compaction list.
      const oldestInPage = parsedMessages.length > 0 ? parsedMessages[0].createdAt : undefined;
      const newestInPage =
        parsedMessages.length > 0 ? parsedMessages[parsedMessages.length - 1].createdAt : undefined;
      const allCompactions = listCompactions(db, req.params.id);
      const markerEntries = allCompactions
        .filter(c => {
          if (oldestInPage == null || newestInPage == null) return parsedMessages.length === 0;
          return c.createdAt >= oldestInPage && c.createdAt <= newestInPage;
        })
        .map(compactionToTimelineEntry);

      // Stable interleave by createdAt; messages with offset come from the
      // messages table and keep relative ordering; markers slot between them.
      // The cast is necessary because StoredSessionMessage uses `offset:
      // number | null` while Message uses `offset?: number`; the marker shape
      // omits offset entirely. Both shapes round-trip safely through the API.
      const result =
        markerEntries.length === 0
          ? parsedMessages
          : // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ([...parsedMessages, ...(markerEntries as any)] as typeof parsedMessages).sort(
              (a, b) => a.createdAt - b.createdAt
            );

      const total = repo.countBySession(req.params.id);
      const hasMore =
        wasTrimmed ||
        (before || after || afterOffset != null || aroundMessageId
          ? messages.length === limit
          : total > limit);

      const oldestTimestamp = result.length > 0 ? result[0].createdAt : undefined;
      const newestTimestamp = result.length > 0 ? result[result.length - 1].createdAt : undefined;
      const maxOffset = result.reduce(
        (max: number | undefined, message: any) =>
          message.offset != null ? Math.max(max ?? 0, message.offset) : max,
        undefined
      );

      const activeRunId = findForegroundActiveRunIdForSession(activeRuns, req.params.id);
      const activeRun = activeRunId ? { runId: activeRunId } : null;

      res.json({
        success: true,
        data: {
          messages: result,
          pagination: {
            total,
            hasMore,
            oldestTimestamp,
            newestTimestamp,
            maxOffset,
          },
          activeRun,
        },
      });
    } catch (error) {
      console.error('Error fetching messages:', error);
      res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed to fetch messages' },
      });
    }
  });

  router.post('/:id/messages', (req: Request, res: Response) => {
    try {
      const { role, content, metadata } = req.body as {
        role?: MessageRole;
        content?: string;
        metadata?: MessageMetadata;
      };

      if (!role || !content) {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Role and content are required' },
        });
        return;
      }

      if (role !== 'user' && role !== 'assistant' && role !== 'system') {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Invalid message role' },
        });
        return;
      }
      // NB: role='system' is accepted here but is not used by current product
      // features. The GET messages endpoint emits compaction markers as
      // synthetic role='system' entries with metadata.compactionMarker —
      // anyone adding real system-role storage must update the desktop
      // renderer's marker sentinel check so it doesn't render real system
      // rows as compaction cards.

      if (!repo.sessionExists(req.params.id)) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Session not found' },
        });
        return;
      }

      const id = newId();
      const now = Date.now();

      const storedMessage = repo.create({
        id,
        sessionId: req.params.id,
        role,
        content,
        metadata,
        createdAt: now,
      });

      if (metadata) {
        const messageRowid = repo.findRowIdById(id);
        if (messageRowid != null) {
          extractAndIndexMetadata(
            db,
            id,
            messageRowid,
            req.params.id,
            metadata as Parameters<typeof extractAndIndexMetadata>[4],
            now
          );
        }
      }

      repo.updateSessionTimestamp(req.params.id, now);

      const message: Message = {
        id: storedMessage.id,
        sessionId: storedMessage.sessionId,
        role: storedMessage.role,
        content: storedMessage.content,
        metadata,
        createdAt: storedMessage.createdAt,
      };

      res.status(201).json({ success: true, data: message } as ApiResponse<Message>);
    } catch (error) {
      console.error('Error creating message:', error);
      res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed to create message' },
      });
    }
  });
}
