/**
 * Claudia message handlers (P0).
 *
 * Every handler normalizes the transport serverId to a canonical backend id
 * and updates ONLY that backend's slice — snapshots and late events for one
 * backend must never touch another backend's state (design §backend 归属与隔离).
 */
import type { ServerMessage } from '@zclaudia/shared';
import { useClaudiaStore } from '../../stores/claudiaStore';
import { useToastStore } from '../../stores/toastStore';
import { parseBackendId } from '../../stores/gatewayStore';
import { resolveCanonicalBackendId } from '../../actions/controlPlane';

/** Canonical backend id for a transport connection (never the raw serverId). */
function canonicalBackendId(serverId: string): string {
  return resolveCanonicalBackendId(parseBackendId(serverId)) ?? serverId;
}

export function handleClaudiaMessage(msg: ServerMessage, serverId: string): boolean {
  switch (msg.type) {
    case 'claudia_request_accepted': {
      const accepted = msg as import('@zclaudia/shared').ClaudiaRequestAcceptedMessage;
      const backendId = canonicalBackendId(serverId);
      const store = useClaudiaStore.getState();
      store.ensureSlice(backendId);
      store.acceptRun(backendId, accepted.clientRequestId, {
        projectId: accepted.projectId,
        branchId: accepted.branchId,
        sessionId: accepted.sessionId,
        runId: accepted.runId,
        branchAction: accepted.branchAction,
        contextReset: accepted.contextReset,
        agentProfileId: accepted.agentProfileId,
        agentProfileSource: accepted.agentProfileSource,
        workingDirectory: accepted.workingDirectory,
        replay: accepted.replay,
        userMessageId: accepted.userMessageId,
        assistantMessageId: accepted.assistantMessageId,
      });
      return true;
    }

    case 'claudia_request_rejected': {
      const rejected = msg as import('@zclaudia/shared').ClaudiaRequestRejectedMessage;
      const backendId = canonicalBackendId(serverId);
      const store = useClaudiaStore.getState();
      store.ensureSlice(backendId);
      store.rejectRun(backendId, rejected.clientRequestId, rejected.code, rejected.error, {
        projectId: rejected.projectId,
        sessionId: rejected.sessionId,
        runId: rejected.runId,
      });
      return true;
    }

    case 'claudia_task_snapshot': {
      const snapshot = msg as import('@zclaudia/shared').ClaudiaTaskSnapshotMessage;
      const backendId = canonicalBackendId(serverId);
      const store = useClaudiaStore.getState();
      store.ensureSlice(backendId);
      // Snapshot replaces only this backend's legacy task references.
      store.setTasks(
        backendId,
        [...snapshot.tasks]
          .sort((a, b) => b.createdAt - a.createdAt)
          .map(t => ({ ...t, branchId: t.branchId ?? null }))
      );
      return true;
    }

    case 'claudia_message_delta': {
      const delta = msg as import('@zclaudia/shared').ClaudiaMessageDeltaMessage;
      const backendId = canonicalBackendId(serverId);
      useClaudiaStore
        .getState()
        .appendRunDelta(backendId, delta.clientRequestId, delta.content, delta.seq);
      return true;
    }

    case 'claudia_message_completed': {
      const completed = msg as import('@zclaudia/shared').ClaudiaMessageCompletedMessage;
      const backendId = canonicalBackendId(serverId);
      useClaudiaStore
        .getState()
        .completeRun(backendId, completed.clientRequestId, completed.responseText, {
          sessionId: completed.sessionId,
          runId: completed.runId,
        });
      return true;
    }

    case 'claudia_message_failed': {
      const failed = msg as import('@zclaudia/shared').ClaudiaMessageFailedMessage;
      const backendId = canonicalBackendId(serverId);
      useClaudiaStore.getState().failRun(backendId, failed.clientRequestId, failed.error, {
        sessionId: failed.sessionId,
        runId: failed.runId,
      });
      return true;
    }

    // Legacy promoted-task messages (protocol kept for old servers/clients).
    case 'claudia_message_promoted': {
      const promoted = msg as import('@zclaudia/shared').ClaudiaMessagePromotedMessage;
      const backendId = canonicalBackendId(serverId);
      const store = useClaudiaStore.getState();
      const inline = store.slices[backendId]?.runs.find(
        run => run.clientRequestId === promoted.clientRequestId
      );
      store.startRun(backendId, {
        clientRequestId: promoted.clientRequestId,
        input: inline?.input ?? '',
        projectId: promoted.projectId,
        threadId: promoted.branchId ?? null,
        status: 'running',
        sessionId: promoted.sessionId,
        branchAction: promoted.branchAction,
        contextReset: promoted.contextReset,
        createdAt: inline?.createdAt ?? Date.now(),
        updatedAt: Date.now(),
      });
      return true;
    }

    case 'claudia_task_created': {
      const created = msg as import('@zclaudia/shared').ClaudiaTaskCreatedMessage;
      const backendId = canonicalBackendId(serverId);
      const store = useClaudiaStore.getState();
      store.ensureSlice(backendId);
      const optimistic = store.slices[backendId]?.tasks.find(t => t.id === created.clientRequestId);
      if (optimistic) {
        store.removeTask(backendId, created.clientRequestId);
        store.addTask(backendId, {
          ...optimistic,
          id: created.taskId,
          sessionId: created.sessionId || null,
          branchId: created.branchId || null,
          branchAction: created.branchAction,
          contextReset: created.contextReset,
          title: created.title,
          status: created.status,
          updatedAt: Date.now(),
        });
      } else {
        store.addTask(backendId, {
          id: created.taskId,
          sessionId: created.sessionId || null,
          branchId: created.branchId || null,
          branchAction: created.branchAction,
          contextReset: created.contextReset,
          input: '',
          title: created.title,
          status: created.status,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      }
      return true;
    }

    case 'claudia_task_delta': {
      // Legacy task streaming — the read-only task reference renders final
      // response text only, so the delta is intentionally not projected.
      return true;
    }

    case 'claudia_task_update': {
      const update = msg as import('@zclaudia/shared').ClaudiaTaskUpdateMessage;
      const backendId = canonicalBackendId(serverId);
      const store = useClaudiaStore.getState();
      store.ensureSlice(backendId);
      const existing = store.slices[backendId]?.tasks.find(t => t.id === update.taskId);
      if (!existing) {
        store.addTask(backendId, {
          id: update.taskId,
          sessionId: update.sessionId || null,
          branchId: update.branchId || null,
          branchAction: update.branchAction,
          contextReset: update.contextReset,
          input: update.input || '',
          title: update.title || update.input || 'Claudia Task',
          status: update.status,
          createdAt: update.createdAt || Date.now(),
          updatedAt: update.updatedAt || Date.now(),
          ...(update.summary ? { summary: update.summary } : {}),
          ...(update.error ? { error: update.error } : {}),
          ...(update.responseText !== undefined ? { responseText: update.responseText } : {}),
          ...(update.toolCount != null ? { toolCount: update.toolCount } : {}),
        });
        return true;
      }
      store.updateTask(backendId, update.taskId, {
        status: update.status,
        ...(update.sessionId ? { sessionId: update.sessionId } : {}),
        ...(update.branchId ? { branchId: update.branchId } : {}),
        ...(update.branchAction ? { branchAction: update.branchAction } : {}),
        ...(update.contextReset !== undefined ? { contextReset: update.contextReset } : {}),
        ...(update.input ? { input: update.input } : {}),
        ...(update.title ? { title: update.title } : {}),
        ...(update.createdAt ? { createdAt: update.createdAt } : {}),
        ...(update.updatedAt ? { updatedAt: update.updatedAt } : {}),
        ...(update.summary ? { summary: update.summary } : {}),
        ...(update.error ? { error: update.error } : {}),
        ...(update.responseText !== undefined ? { responseText: update.responseText } : {}),
        ...(update.toolCount != null ? { toolCount: update.toolCount } : {}),
      });
      if (
        update.status === 'completed' ||
        update.status === 'failed' ||
        update.status === 'cancelled'
      ) {
        const taskTitle = existing.title || update.title || update.input || 'Claudia task';
        useToastStore.getState().add({
          title: taskTitle,
          message:
            update.status === 'completed'
              ? update.summary?.slice(0, 100) || 'Task completed'
              : update.error?.slice(0, 100) || 'Task failed',
          type: update.status === 'completed' ? 'success' : 'error',
          icon: update.status === 'completed' ? 'task' : 'error',
          initiator: 'claudia',
          sessionId: existing.sessionId ?? update.sessionId ?? undefined,
          serverId,
        });
      }
      return true;
    }

    default:
      return false;
  }
}
