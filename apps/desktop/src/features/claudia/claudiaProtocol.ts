import type { Attachment } from '../chat';
import type { ClaudiaMessageMessage } from '@zclaudia/shared/wire/messages/claudia';
import type { AgentCancelMessage } from '@zclaudia/shared/wire/messages/run';

/**
 * Wire-protocol assembly for Claudia runs (design §身份契约). Pure functions so
 * the submit path stays declarative and the inline JSON envelope for
 * attachments lives in exactly one place.
 */

export function buildClaudiaMessage(params: {
  clientRequestId: string;
  content: string;
  attachments?: Attachment[];
  projectId: string;
  /** Explicit profile selection — ignored when resuming the current thread. */
  explicitProfileId?: string;
  resumeCurrent: boolean;
  targetThreadId: string | null | undefined;
  forceNew: boolean;
}): ClaudiaMessageMessage {
  const {
    clientRequestId,
    content,
    attachments,
    projectId,
    explicitProfileId,
    resumeCurrent,
    targetThreadId,
    forceNew,
  } = params;
  return {
    type: 'claudia_message',
    clientRequestId,
    // Attachments ride inside `input` as a JSON envelope; plain text stays raw.
    input: attachments?.length ? JSON.stringify({ text: content, attachments }) : content,
    projectId,
    ...(!resumeCurrent && explicitProfileId ? { agentProfileId: explicitProfileId } : {}),
    ...(targetThreadId && !forceNew ? { activeBranchId: targetThreadId } : {}),
    ...(forceNew ? { forceNewBranch: true } : {}),
  };
}

export function buildAgentCancelMessage(sessionId: string, runId?: string): AgentCancelMessage {
  return {
    type: 'agent_cancel',
    sessionId,
    ...(runId ? { runId } : {}),
  } as AgentCancelMessage;
}
