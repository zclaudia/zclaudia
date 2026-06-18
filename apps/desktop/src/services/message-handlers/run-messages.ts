import type { ServerMessage } from '@zclaudia/shared';
import type { MessageDispatchContext } from './types';
import { useRunStore } from '../../stores/runStore';
import { useChatMessageStore } from '../../stores/chatMessageStore';
import { useSessionConfigStore } from '../../stores/sessionConfigStore';
import { useComposerStore } from '../../stores/composerStore';
import { useInteractionStore } from '../../stores/interactionStore';
import { usePermissionStore } from '../../stores/permissionStore';
import { usePromptRequestStore } from '../../stores/promptRequestStore';
import { useSessionRunStateStore } from '../../stores/sessionRunStateStore';
import { useServerStore } from '../../stores/serverStore';
import { useToastStore } from '../../stores/toastStore';
import { eagerSyncCurrentSession, recoverCurrentSessionTail } from '../sessionSync';
import { getSessionCompaction } from '../api/sessions';
import { scheduleDelta, flushDeltaForRun } from './delta-buffer';

/**
 * Translate a Codex OAuth error code into a user-facing message.
 * Returns undefined when the code is not a known Codex OAuth code,
 * so callers can fall back to the raw error string.
 */
function describeCodexOAuthError(code: string | undefined): string | undefined {
  switch (code) {
    case 'NOT_AUTHENTICATED':
    case 'REFRESH_FAILED_TERMINAL':
      return 'Codex 凭证已失效，请在设置中重新登录。';
    case 'REFRESH_FAILED_TRANSIENT':
      return '网络异常，请稍后重试。';
    case 'RESPONSE_ENDPOINT_REJECTED':
      return '当前 ChatGPT 订阅不支持该模型，请检查 plan 或更换模型。';
    case 'OAUTH_PORT_CONFLICT':
      return '端口 1455 被占用，请关闭其他正在进行登录的进程后再试。';
    default:
      return undefined;
  }
}

export function handleRunMessage(msg: ServerMessage, ctx: MessageDispatchContext): boolean {
  const { serverId, backendId, serverRunsRef, logTag } = ctx;
  const activeServerId = useServerStore.getState().activeServerId;

  switch (msg.type) {
    case 'delta': {
      if (ctx.isRunEventGap(msg.runId, msg.seq)) ctx.recoverRunGap(msg.runId, msg.seq, msg.sessionId);
      if (ctx.isStaleRunEvent(msg.runId, msg.seq)) return true;
      useRunStore.getState().clearRunRetryStatus(msg.runId);
      const deltaSession = msg.sessionId || useRunStore.getState().activeRuns[msg.runId];
      if (deltaSession) {
        scheduleDelta(deltaSession, msg.runId, msg.content);
      } else if (msg.runId) {
        console.warn(`[${logTag}] Delta for untracked run ${msg.runId}`);
      }
      return true;
    }

    case 'run_started': {
      if (ctx.isRunEventGap(msg.runId, msg.seq)) ctx.recoverRunGap(msg.runId, msg.seq, msg.sessionId);
      if (ctx.isStaleRunEvent(msg.runId, msg.seq)) return true;
      ctx.clearTerminalRunSeq(msg.runId);
      const targetSessionId = msg.sessionId;
      if (!targetSessionId) {
        console.warn('[messageHandler] run_started missing sessionId, ignoring');
        return true;
      }
      const assistantMsgId = msg.assistantMessageId || msg.runId;
      const userMsgId = msg.userMessageId;
      const clientReqId = msg.clientRequestId;
      const isBackground = msg.sessionType === 'background';

      const chat = useRunStore.getState();
      const alreadyTrackingRun = chat.activeRuns[msg.runId] === targetSessionId;
      chat.startRun(msg.runId, targetSessionId, isBackground);
      const now = Date.now();
      chat.updateRunHealth(msg.runId, {
        sessionId: targetSessionId,
        startedAt: now,
        lastActivityAt: now,
        health: 'healthy',
      });
      if (serverId === activeServerId) {
        useSessionConfigStore.getState().clearSystemInfo(targetSessionId);
      }
      if (userMsgId && clientReqId) useChatMessageStore.getState().updateMessageIdByClientMessageId(targetSessionId, clientReqId, userMsgId);
      if (msg.assistantMessageId || !alreadyTrackingRun) {
        useChatMessageStore.getState().addMessage(targetSessionId, {
          id: assistantMsgId,
          sessionId: targetSessionId,
          role: 'assistant',
          content: '',
          createdAt: Date.now(),
        });
      }

      if (!isBackground) {
        if (!serverRunsRef.has(serverId)) {
          serverRunsRef.set(serverId, new Set());
        }
        serverRunsRef.get(serverId)!.add(msg.runId);

        useSessionRunStateStore.getState().markRunStarted({
          backendId,
          runId: msg.runId,
          sessionId: targetSessionId,
          sessionType: msg.sessionType,
          source: 'run_event',
        });
      }
      return true;
    }

    case 'run_completed': {
      if (ctx.isRunEventGap(msg.runId, msg.seq)) ctx.recoverRunGap(msg.runId, msg.seq, msg.sessionId);
      if (ctx.isStaleRunEvent(msg.runId, msg.seq)) return true;
      flushDeltaForRun(msg.runId);
      const completedSession = msg.sessionId || useRunStore.getState().activeRuns[msg.runId];
      console.log(`[${logTag}] run_completed runId=${msg.runId} sessionId=${completedSession ?? 'unknown'} seq=${msg.seq ?? 'none'}`);
      if (completedSession) {
        usePromptRequestStore.getState().clearRequestsForSession(completedSession);
        usePermissionStore.getState().clearRequestsForSession(completedSession);
        useInteractionStore.getState().clearSession(completedSession);
        useRunStore.getState().finalizeRunToMessage(msg.runId);
        if (msg.usage) {
          useSessionConfigStore.getState().addSessionUsage(completedSession, msg.usage);
        }
        useSessionRunStateStore.getState().markRunEnded({
          backendId,
          runId: msg.runId,
          sessionId: completedSession,
          source: 'run_event',
          cleanupChatRuns: false,
        });
        void eagerSyncCurrentSession(serverId);
        void recoverCurrentSessionTail(serverId, completedSession);
      }
      ctx.recordTerminalRun(msg.runId, msg.seq);
      ctx.clearRunActivity(msg.runId);
      useRunStore.getState().endRun(msg.runId);
      serverRunsRef.get(serverId)?.delete(msg.runId);
      ctx.clearRunSeq(msg.runId);
      return true;
    }

    case 'run_failed': {
      if (ctx.isRunEventGap(msg.runId, msg.seq)) ctx.recoverRunGap(msg.runId, msg.seq, msg.sessionId);
      if (ctx.isStaleRunEvent(msg.runId, msg.seq)) return true;
      flushDeltaForRun(msg.runId);
      const failedSession = msg.sessionId || useRunStore.getState().activeRuns[msg.runId];
      console.log(`[${logTag}] run_failed runId=${msg.runId} sessionId=${failedSession ?? 'unknown'} seq=${msg.seq ?? 'none'}`);
      if (failedSession) {
        usePromptRequestStore.getState().clearRequestsForSession(failedSession);
        usePermissionStore.getState().clearRequestsForSession(failedSession);
        useInteractionStore.getState().clearSession(failedSession);
        if (msg.error) {
          const codexToast = describeCodexOAuthError(msg.errorCode);
          if (codexToast) {
            useToastStore.getState().add({
              type: 'error',
              title: 'Codex 认证错误',
              message: codexToast,
              sessionId: failedSession,
              serverId,
              icon: 'error',
            });
          }
          useChatMessageStore.getState().appendToLastMessage(failedSession, `\n\n**Error:** ${msg.error}`);
        }
        useRunStore.getState().finalizeRunToMessage(msg.runId);
        useSessionRunStateStore.getState().markRunEnded({
          backendId,
          runId: msg.runId,
          sessionId: failedSession,
          source: 'run_event',
          cleanupChatRuns: false,
        });
        // Steer cancel path: server returns un-consumed steer drafts joined as restoreDraft
        // so the input box reflows the steer text the user can edit + resend as a new run.
        if (msg.restoreDraft && serverId === activeServerId) {
          useComposerStore.getState().setPendingPrefill(failedSession, msg.restoreDraft);
        }
        void eagerSyncCurrentSession(serverId);
        void recoverCurrentSessionTail(serverId, failedSession);
      }
      ctx.recordTerminalRun(msg.runId, msg.seq);
      ctx.clearRunActivity(msg.runId);
      useRunStore.getState().endRun(msg.runId);
      serverRunsRef.get(serverId)?.delete(msg.runId);
      ctx.clearRunSeq(msg.runId);
      console.error(`[${logTag}] Run failed:`, msg.error);
      return true;
    }

    case 'run_retrying': {
      if (ctx.isStaleRunEvent(msg.runId, msg.seq)) return true;
      const retryingSession = msg.sessionId || useRunStore.getState().activeRuns[msg.runId];
      console.log(`[${logTag}] run_retrying runId=${msg.runId} attempt=${msg.attempt}/${msg.maxAttempts} delayMs=${msg.delayMs} status=${msg.status ?? 'network'}`);
      if (retryingSession) {
        useRunStore.getState().updateRunRetryStatus(msg.runId, {
          sessionId: retryingSession,
          attempt: msg.attempt,
          maxAttempts: msg.maxAttempts,
          delayMs: msg.delayMs,
          status: msg.status,
          receivedAt: Date.now(),
        });
      }
      return true;
    }

    case 'message_appended': {
      // Mid-run steer broadcast: render the user message immediately in the stream
      // so the user sees feedback before the agent's next turn picks it up.
      const appendedSession = msg.sessionId;
      if (!appendedSession) {
        console.warn(`[${logTag}] message_appended missing sessionId, ignoring`);
        return true;
      }
      // Stable id derived from runId + timestamp so any later history sync
      // (e.g. recoverCurrentSessionTail after cancel) deduplicates correctly.
      const stableId = `steer-${msg.runId}-${msg.timestamp}`;
      useChatMessageStore.getState().addMessage(appendedSession, {
        id: stableId,
        clientMessageId: stableId,
        sessionId: appendedSession,
        role: msg.role,
        content: msg.content,
        createdAt: msg.timestamp,
        metadata: msg.steered ? { steered: true } : undefined,
      });
      return true;
    }

    case 'tool_use': {
      if (ctx.isRunEventGap(msg.runId, msg.seq)) ctx.recoverRunGap(msg.runId, msg.seq, msg.sessionId);
      if (ctx.isStaleRunEvent(msg.runId, msg.seq)) return true;
      useRunStore.getState().clearRunRetryStatus(msg.runId);
      const toolSession = msg.sessionId || useRunStore.getState().activeRuns[msg.runId];
      if (toolSession) {
        useRunStore.getState().addToolCall(msg.runId, msg.toolUseId, msg.toolName, msg.toolInput, msg.semantic, msg.effect);
        useRunStore.getState().addToolUseBlock(msg.runId, msg.toolUseId);
      } else if (msg.runId) {
        console.warn(`[${logTag}] tool_use for untracked run ${msg.runId}`);
      }
      return true;
    }

    case 'tool_result': {
      if (ctx.isRunEventGap(msg.runId, msg.seq)) ctx.recoverRunGap(msg.runId, msg.seq, msg.sessionId);
      if (ctx.isStaleRunEvent(msg.runId, msg.seq)) return true;
      useRunStore.getState().clearRunRetryStatus(msg.runId);
      const resultSession = msg.sessionId || useRunStore.getState().activeRuns[msg.runId];
      if (resultSession) {
        useRunStore.getState().updateToolCallResult(msg.runId, msg.toolUseId, msg.result, msg.isError, msg.effect);
      } else if (msg.runId) {
        console.warn(`[${logTag}] tool_result for untracked run ${msg.runId}`);
      }
      return true;
    }

    case 'tool_activity': {
      if (ctx.isRunEventGap(msg.runId, msg.seq)) ctx.recoverRunGap(msg.runId, msg.seq, msg.sessionId);
      if (ctx.isStaleRunEvent(msg.runId, msg.seq)) return true;
      useRunStore.getState().clearRunRetryStatus(msg.runId);
      if (msg.runId && msg.toolUseId && msg.content) {
        useRunStore.getState().updateToolCallActivity(msg.runId, msg.toolUseId, msg.content);
      }
      return true;
    }

    case 'mode_change':
      if (ctx.isRunEventGap(msg.runId, msg.seq)) ctx.recoverRunGap(msg.runId, msg.seq, msg.sessionId);
      if (ctx.isStaleRunEvent(msg.runId, msg.seq)) return true;
      useSessionConfigStore.getState().setRuntimeMode(msg.sessionId, msg.mode);
      // Pass the mode string through directly so the UI selector stays
      // consistent with the backend's actual mode (e.g. AI-entered plan mode
      // mid-run). Selector values match the same vocabulary.
      useSessionConfigStore.getState().setMode(msg.sessionId, msg.mode);
      return true;

    case 'system_info':
      if (ctx.isStaleRunEvent(msg.runId, msg.seq)) return true;
      if (serverId === activeServerId) {
        const sessionId = useRunStore.getState().activeRuns[msg.runId];
        if (sessionId) {
          useSessionConfigStore.getState().setSystemInfo(sessionId, msg.systemInfo);
        } else {
          console.warn(`[${logTag}] system_info for untracked run ${msg.runId}`);
        }
      }
      return true;

    case 'compaction_failed': {
      const sessionId = msg.sessionId;
      if (!sessionId) {
        console.warn(`[${logTag}] compaction_failed missing sessionId, ignoring`);
        return true;
      }
      console.warn(`[${logTag}] compaction_failed session=${sessionId} reason=${msg.reason} breakerOpen=${msg.breakerOpen}`);
      useSessionConfigStore.getState().setCompactionNotice(sessionId, {
        sessionId,
        reason: msg.reason,
        breakerOpen: msg.breakerOpen,
        nextRetryAtMs: msg.nextRetryAtMs,
        receivedAt: Date.now(),
      });
      return true;
    }

    case 'compaction_completed': {
      // Wire-level event: server has persisted a session_compactions row. Fetch
      // the full marker payload and append a synthetic system message carrying
      // it via metadata.compactionMarker (mirrors how the server's messages
      // list endpoint surfaces persisted markers). The result: the
      // CompactionMarkerCard appears inline without a full history reload.
      const sessionId = msg.sessionId;
      const compactionId = msg.compactionId;
      if (!sessionId || !compactionId) {
        console.warn(`[${logTag}] compaction_completed missing sessionId/compactionId, ignoring`);
        return true;
      }
      useSessionConfigStore.getState().clearCompactionNotice(sessionId);
      void getSessionCompaction(sessionId, compactionId)
        .then((c) => {
          useChatMessageStore.getState().addMessage(sessionId, {
            id: c.id,
            sessionId: c.sessionId,
            role: 'system',
            content: '',
            createdAt: c.createdAt,
            metadata: {
              compactionMarker: {
                compactionId: c.id,
                summary: c.summary,
                tokensBefore: c.tokensBefore,
                source: c.source,
                customInstructions: c.customInstructions ?? undefined,
                readFiles: c.details?.readFiles ?? [],
                modifiedFiles: c.details?.modifiedFiles ?? [],
                createdAt: c.createdAt,
              },
            },
          });
        })
        .catch((err: unknown) => {
          console.warn(`[${logTag}] compaction_completed: failed to fetch compaction ${compactionId}:`, err);
        });
      return true;
    }

    default:
      return false;
  }
}

