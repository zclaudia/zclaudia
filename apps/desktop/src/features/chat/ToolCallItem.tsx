import { useMemo, memo } from 'react';
import { type ToolCallState } from '../../stores/runStore';
import { useConnection } from '../../contexts/ConnectionContext';
import { useSelectionStore } from '../../stores/selectionStore';
import { useInteractionStore } from '../../stores/interactionStore';
import { usePromptRequestStore } from '../../stores/promptRequestStore';
import { InteractionItem } from './InteractionItem';
import { isPlanProposalTool, isInteractionTool } from './tool-call/toolClassifiers';
import {
  normalizeToolInput,
  extractQuestions,
  extractInteractionId,
  buildAskUserQuestionInteraction,
} from './tool-call/toolFormatters';
import { ToolCallCard } from './tool-call/ToolCallCard';
import { useRunInTerminal } from './tool-call/useRunInTerminal';

interface ToolCallItemProps {
  toolCall: ToolCallState;
}

/**
 * Connected wrapper around the pure ToolCallCard: resolves the session and
 * any interaction that supersedes the tool card (store lookups stay host-side
 * so the card itself has zero global dependencies), and wires the host
 * capabilities (send-to-background, run-in-terminal) as callbacks.
 */
export const ToolCallItem = memo(function ToolCallItem({ toolCall }: ToolCallItemProps) {
  const { toolName, toolInput, result, semantic } = toolCall;
  const selectedSessionId = useSelectionStore(s => s.selectedSessionId);
  const { sendMessage } = useConnection();
  const runInTerminal = useRunInTerminal();
  const pendingPromptRequest = usePromptRequestStore(s => {
    if (!selectedSessionId || toolName !== 'AskUserQuestion') return null;
    for (let i = s.pendingRequests.length - 1; i >= 0; i--) {
      if (
        s.pendingRequests[i].sessionId === selectedSessionId &&
        s.pendingRequests[i].requestId === toolCall.id
      ) {
        return s.pendingRequests[i];
      }
    }
    return null;
  });
  const fallbackPromptInteraction = useMemo(() => {
    if (!selectedSessionId || !pendingPromptRequest || toolName !== 'AskUserQuestion') return null;
    const normalizedInput = normalizeToolInput(toolInput) as Record<string, unknown> | undefined;
    const questions = extractQuestions(normalizedInput?.questions);
    if (questions.length === 0) return null;
    return buildAskUserQuestionInteraction({
      interactionId: pendingPromptRequest.requestId,
      sessionId: selectedSessionId,
      questions,
    });
  }, [pendingPromptRequest, selectedSessionId, toolInput, toolName]);

  // Phase 1 dedup: render InteractionItem instead of interaction tool when interaction store has it
  const interactionId = extractInteractionId(result);
  const interaction = useInteractionStore(s => {
    const direct =
      s.interactions[toolCall.id] || (interactionId ? s.interactions[interactionId] : undefined);
    if (direct) return direct;

    // A plan-proposal tool creates a separate interaction before the tool
    // result exists. We match on the shared semantic (plus the MCP bridge
    // suffix fallback) instead of provider-specific tool names.
    if (selectedSessionId && isPlanProposalTool(toolName, semantic)) {
      return Object.values(s.interactions)
        .filter(
          item => item.sessionId === selectedSessionId && item.type === 'interaction_plan_review'
        )
        .sort((a, b) => b.createdAt - a.createdAt)[0];
    }

    return undefined;
  });
  const onSendToBackground = useMemo(() => {
    if (!selectedSessionId) return undefined;
    return () => {
      sendMessage({
        type: 'background_running_command',
        sessionId: selectedSessionId,
        toolUseId: toolCall.id,
      });
    };
  }, [selectedSessionId, sendMessage, toolCall.id]);

  const resolvedInteraction = interaction ?? fallbackPromptInteraction;
  if (resolvedInteraction && isInteractionTool(toolName, semantic)) {
    if (
      resolvedInteraction.type === 'interaction_todo_update' &&
      resolvedInteraction.todos.length > 0
    ) {
      return <InteractionItem interaction={resolvedInteraction} />;
    }
    if (
      resolvedInteraction.type === 'interaction_prompt' ||
      resolvedInteraction.type === 'interaction_approval' ||
      resolvedInteraction.type === 'interaction_plan_review'
    ) {
      return <InteractionItem interaction={resolvedInteraction} />;
    }
  }

  return (
    <ToolCallCard
      toolCall={toolCall}
      onSendToBackground={onSendToBackground}
      runInTerminal={runInTerminal}
    />
  );
});
