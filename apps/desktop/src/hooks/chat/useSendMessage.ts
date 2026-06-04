import { useState, useCallback, useMemo } from 'react';
import type { UnifiedPermissionPolicy, ClientMessage, MessageAttachment, MessageInput as MessageInputData } from '@zclaudia/shared';
import type { Attachment } from '../../features/chat/MessageInput';
import type { MessageWithToolCalls } from '../../stores/chatStore';
import { useInteractionStore } from '../../stores/interactionStore';
import { useProjectStore } from '../../stores/projectStore';
import { useToastStore } from '../../stores/toastStore';
import { uploadFile } from '../../services/fileUpload';
import * as api from '../../services/api';

const ATTACHMENT_PLACEHOLDER = '[Attachments]';

interface RunStartMessage {
  type: 'run_start';
  clientRequestId: string;
  sessionId: string;
  input: string;
  resend?: boolean;
  mode?: string;
  permissionOverride?: Partial<UnifiedPermissionPolicy>;
  workingDirectory?: string;
}

interface UseSendMessageParams {
  sessionId: string;
  isConnected: boolean;
  isLoading: boolean;
  sessionRunId: string | null;
  isSessionRunning: boolean;
  lastSessionMessage: MessageWithToolCalls | null;
  mode: string;
  permissionOverride: Partial<UnifiedPermissionPolicy> | null;
  currentSession: { workingDirectory?: string; lastRunStatus?: string | null } | undefined;
  addMessage: (sessionId: string, message: MessageWithToolCalls) => void;
  scrollToBottom: (instant?: boolean) => void;
  wsSendMessage: (msg: ClientMessage) => void;
}

interface ReconcileStaleRunParams {
  sessionId: string;
  sessionRunId: string | null;
  isLoading: boolean;
  getSessionRunState: typeof api.getSessionRunState;
  clearLocalRun: (runId: string) => void;
  clearSessionActive: (sessionId: string) => void;
}

export async function reconcileStaleLoadingRun({
  sessionId,
  sessionRunId,
  isLoading,
  getSessionRunState,
  clearLocalRun,
  clearSessionActive,
}: ReconcileStaleRunParams): Promise<boolean> {
  if (!isLoading || !sessionRunId) return false;

  const runState = await getSessionRunState(sessionId);
  if (runState.isRunning) return false;

  console.warn('[useSendMessage] Clearing stale local run state:', {
    sessionId,
    localRunId: sessionRunId,
  });
  clearLocalRun(sessionRunId);
  clearSessionActive(sessionId);
  return true;
}

export function useSendMessage({
  sessionId,
  isConnected,
  isLoading,
  sessionRunId,
  isSessionRunning,
  lastSessionMessage,
  mode,
  permissionOverride,
  currentSession,
  addMessage,
  scrollToBottom,
  wsSendMessage,
}: UseSendMessageParams) {
  // ── Local state ──
  const [lastSentMessage, setLastSentMessage] = useState<{ content: string; attachments?: Attachment[] } | null>(null);
  const [restoreMessage, setRestoreMessage] = useState<{ content: string; attachments?: Attachment[] } | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [resendChecking, setResendChecking] = useState(false);

  // ── Resend logic ──
  const resendTargetMessage = useMemo(() => {
    if (!lastSessionMessage || lastSessionMessage.role !== 'user' || isSessionRunning) {
      return null;
    }
    return lastSessionMessage;
  }, [lastSessionMessage, isSessionRunning]);

  const resendText = useMemo(() => {
    if (!resendTargetMessage) return null;
    const raw = (resendTargetMessage.content || '').trim();
    if (!raw || raw === ATTACHMENT_PLACEHOLDER) return null;
    try {
      const parsed = JSON.parse(raw) as { text?: string };
      if (parsed && typeof parsed === 'object' && typeof parsed.text === 'string') {
        const text = parsed.text.trim();
        return text || null;
      }
    } catch {
      // Plain text fallback
    }
    return raw;
  }, [resendTargetMessage]);

  // ── Internal helpers ──
  const clearInterruptedStatus = useCallback(async () => {
    if (currentSession?.lastRunStatus !== 'interrupted') return;
    useProjectStore.getState().updateSession(sessionId, { lastRunStatus: null });
    try {
      await api.dismissInterrupted(sessionId);
    } catch (error) {
      console.warn('[useSendMessage] Failed to persist interrupted status dismissal:', error);
    }
  }, [currentSession?.lastRunStatus, sessionId]);

  const startRun = useCallback(async (runStartMsg: RunStartMessage) => {
    await clearInterruptedStatus();
    wsSendMessage(runStartMsg);
  }, [clearInterruptedStatus, wsSendMessage]);

  // ── Send message ──
  const handleSendMessage = useCallback(async (content: string, attachments?: Attachment[], overrideMode?: string) => {
    if (!content.trim() && !attachments?.length) return;

    if (!isConnected) {
      useToastStore.getState().add({
        type: 'error',
        title: '后端未连接',
        message: '无法发送消息：远程后端未连接。请稍后重试。',
      });
      return;
    }

    if (isLoading) {
      if (!sessionRunId) {
        console.warn('[useSendMessage] isLoading but no sessionRunId — cannot steer');
        return;
      }
      if (attachments?.length) {
        setUploadError('Cannot send attachments while agent is running — cancel first or wait');
        return;
      }
      const trimmed = content.trim();
      if (!trimmed) return;
      wsSendMessage({
        type: 'run_steer',
        runId: sessionRunId,
        content: trimmed,
      });
      return;
    }

    setLastSentMessage({ content, attachments });
    setRestoreMessage(null);
    setUploadError(null);

    let uploadedAttachments: MessageAttachment[] = [];

    if (attachments && attachments.length > 0) {
      try {
        for (const attachment of attachments) {
          const blob = await (await fetch(attachment.data)).blob();
          const file = new File([blob], attachment.name, { type: attachment.mimeType });
          const uploaded = await uploadFile(file);
          uploadedAttachments.push({
            fileId: uploaded.fileId,
            name: uploaded.name,
            mimeType: uploaded.mimeType,
            type: attachment.type
          });
        }
      } catch (error) {
        console.error('Failed to upload attachments:', error);
        setUploadError(error instanceof Error ? error.message : 'Failed to upload file');
        return;
      }
    }

    const messageInput: MessageInputData = {
      text: content,
      attachments: uploadedAttachments.length > 0 ? uploadedAttachments : undefined
    };

    const fullContent = JSON.stringify(messageInput);
    const clientMessageId = crypto.randomUUID();

    addMessage(sessionId, {
      id: clientMessageId,
      clientMessageId,
      sessionId,
      role: 'user',
      content: content || ATTACHMENT_PLACEHOLDER,
      createdAt: Date.now(),
    });

    const effectiveMode = overrideMode ?? mode;
    const runStartMsg: RunStartMessage = {
      type: 'run_start',
      clientRequestId: clientMessageId,
      sessionId,
      input: fullContent,
      mode: effectiveMode || undefined,
      permissionOverride: permissionOverride || undefined,
      workingDirectory: currentSession?.workingDirectory || undefined,
    };
    console.log('[useSendMessage] run_start:', { sessionId, mode: runStartMsg.mode, workingDirectory: runStartMsg.workingDirectory });
    await startRun(runStartMsg);
    useInteractionStore.getState().clearClientSynthPlanReviewsForSession(sessionId);

    setTimeout(() => scrollToBottom(), 100);
  }, [sessionId, isConnected, isLoading, sessionRunId, mode, permissionOverride, currentSession, addMessage, startRun, scrollToBottom, wsSendMessage]);

  // ── Resend last message ──
  const handleResendLastMessage = useCallback(async () => {
    if (!resendText) return;
    setResendChecking(true);
    try {
      const runState = await api.getSessionRunState(sessionId);
      if (runState.isRunning) {
        addMessage(sessionId, {
          id: crypto.randomUUID(),
          sessionId,
          role: 'system',
          content: `Cannot resend yet: session is still running${runState.activeRunId ? ` (${runState.activeRunId})` : ''}.`,
          createdAt: Date.now(),
        });
        return;
      }
      const messageInput: MessageInputData = { text: resendText };
      await startRun({
        type: 'run_start',
        clientRequestId: crypto.randomUUID(),
        sessionId,
        input: JSON.stringify(messageInput),
        resend: true,
        mode: mode || undefined,
        permissionOverride: permissionOverride || undefined,
        workingDirectory: currentSession?.workingDirectory || undefined,
      });
      setTimeout(() => scrollToBottom(), 100);
    } catch (error) {
      console.error('Resend preflight failed:', error);
      addMessage(sessionId, {
        id: crypto.randomUUID(),
        sessionId,
        role: 'system',
        content: 'Resend preflight failed. Please try again.',
        createdAt: Date.now(),
      });
    } finally {
      setResendChecking(false);
    }
  }, [resendText, sessionId, addMessage, startRun, mode, permissionOverride, currentSession, scrollToBottom]);

  // ── Cancel ──
  const handleCancelRun = useCallback(() => {
    if (lastSentMessage) {
      setRestoreMessage(lastSentMessage);
      setLastSentMessage(null);
    }
    if (!sessionRunId) {
      console.warn('[useSendMessage] No active run for this session');
      return;
    }
    wsSendMessage({ type: 'run_cancel', runId: sessionRunId });
  }, [lastSentMessage, sessionRunId, wsSendMessage]);

  // ── Reset on session switch ──
  const resetSendState = useCallback(() => {
    setLastSentMessage(null);
    setRestoreMessage(null);
    setUploadError(null);
    setResendChecking(false);
  }, []);

  return {
    handleSendMessage,
    handleCancelRun,
    handleResendLastMessage,
    startRun,
    clearInterruptedStatus,
    // State
    restoreMessage,
    uploadError,
    resendTargetMessage,
    resendText,
    resendChecking,
    // Reset
    resetSendState,
  };
}
