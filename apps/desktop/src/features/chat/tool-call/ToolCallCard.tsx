import { useState, useEffect, useRef, memo } from 'react';
import {
  CheckCircle2,
  XCircle,
  Loader2,
  ChevronDown,
  ChevronRight,
  SendToBack,
} from 'lucide-react';
import { type ToolCallState } from '../../../stores/runStore';
import { getToolIcon } from '../../../config/icons';
import { Icon } from '../../../components/ui/Icon';
import {
  isTodoTool,
  isAskUserFormTool,
  isApprovalTool,
  isPushFileTool,
  isPlanProposalTool,
} from './toolClassifiers';
import { formatToolInput } from './toolFormatters';
import { ToolExpandedContent } from './ToolExpandedContent';

export interface ToolCallCardProps {
  toolCall: ToolCallState;
  /**
   * Host capability: move this running command to the background. Present ⇒
   * a running Bash card offers "Send to background".
   */
  onSendToBackground?: () => void;
  /** Host capability: paste a command into the terminal (expanded Bash view). */
  runInTerminal?: (command: string) => void;
}

/**
 * Pure presentational tool-call card: header with status/summary, optional
 * host-capability affordances, and the tool-specific expanded body. No store
 * or context access — everything arrives through props, so this is the
 * extraction candidate for the shared transcript component layer. Interaction
 * routing (rendering an InteractionItem instead) is the connected wrapper's
 * job (ToolCallItem.tsx).
 */
export const ToolCallCard = memo(function ToolCallCard({
  toolCall,
  onSendToBackground,
  runInTerminal,
}: ToolCallCardProps) {
  // Plan proposals auto-expand on completion so the plan body and the
  // "Execute plan" button are visible without an extra click. The state is
  // user-toggleable afterwards; `autoExpandedRef` ensures we only auto-expand
  // once per tool call (so user collapses stick).
  const [isExpanded, setIsExpanded] = useState(
    () =>
      isPlanProposalTool(toolCall.toolName, toolCall.semantic) && toolCall.status === 'completed'
  );
  const autoExpandedRef = useRef(
    isPlanProposalTool(toolCall.toolName, toolCall.semantic) && toolCall.status === 'completed'
  );
  useEffect(() => {
    if (autoExpandedRef.current) return;
    if (!isPlanProposalTool(toolCall.toolName, toolCall.semantic)) return;
    if (toolCall.status !== 'completed') return;
    autoExpandedRef.current = true;
    setIsExpanded(true);
  }, [toolCall.status, toolCall.toolName, toolCall.semantic]);
  const [backgroundRequested, setBackgroundRequested] = useState(false);
  const { toolName, toolInput, status, result, isError, activity, semantic, effect } = toolCall;

  const icon = getToolIcon(toolName);
  const displayName = isTodoTool(toolName)
    ? 'TodoWrite'
    : isAskUserFormTool(toolName)
      ? 'AskUserForm'
      : isApprovalTool(toolName)
        ? 'RequestApproval'
        : isPushFileTool(toolName)
          ? 'PushFile'
          : toolName;
  const summary = formatToolInput(toolName, toolInput, semantic);

  // AskUserQuestion: user answers come back as "deny" (isError=true), but that's expected behavior
  const showAsError = isError && toolName !== 'AskUserQuestion';

  return (
    <div
      data-testid="tool-use"
      className={`my-2 rounded-xl shadow-apple-sm border ${
        status === 'running'
          ? 'border-primary/30 bg-muted/40'
          : showAsError
            ? 'border-destructive/30 bg-destructive/5'
            : 'border-success/30 bg-success/5'
      }`}
    >
      {/* Header - clickable to expand/collapse */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/50 active:bg-muted/50 rounded-lg transition-colors"
      >
        {/* Status indicator */}
        {status === 'running' ? (
          <Loader2 size={14} className="animate-spin text-primary" />
        ) : showAsError ? (
          <XCircle size={14} className="text-destructive" />
        ) : (
          <CheckCircle2 size={14} className="text-success" />
        )}

        {/* Tool icon and name */}
        <Icon icon={icon} size={14} className="text-muted-foreground" />
        <span className="text-xs font-medium text-foreground" data-testid="tool-name">
          {displayName}
        </span>

        {/* Summary */}
        <span className="flex-1 text-xs text-muted-foreground truncate ml-2">{summary}</span>

        {/* Expand/collapse indicator */}
        <span className="text-muted-foreground">
          {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
      </button>

      {/* Running Bash: let the user free the session by sending the command to background */}
      {status === 'running' && toolName === 'Bash' && onSendToBackground && (
        <div className="px-3 pb-2 -mt-1 pl-9">
          <button
            onClick={e => {
              e.stopPropagation();
              if (backgroundRequested) return;
              setBackgroundRequested(true);
              onSendToBackground();
            }}
            disabled={backgroundRequested}
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors"
          >
            <SendToBack size={11} />
            {backgroundRequested ? 'Moving to background…' : 'Send to background'}
          </button>
        </div>
      )}

      {/* Subagent activity indicator — shows what the Agent is currently doing */}
      {status === 'running' && activity && toolName === 'Agent' && (
        <div className="px-3 pb-2 -mt-1">
          <div className="text-[11px] text-muted-foreground truncate pl-6">{activity}</div>
        </div>
      )}

      {/* Expanded content — tool-specific rendering */}
      {isExpanded && (
        <ToolExpandedContent
          toolName={toolName}
          toolInput={toolInput}
          status={status}
          result={result}
          isError={isError}
          semantic={semantic}
          effect={effect}
          runInTerminal={runInTerminal}
        />
      )}
    </div>
  );
});
