/**
 * Tool-naming conventions now live in the kit, which every host shares: MCP
 * bridges spell the same capability many ways, and the predicates match on the
 * terminating bare name. Re-exported here so this app keeps one import path
 * for them.
 */
export {
  isTodoTool,
  isAskUserFormTool,
  isApprovalTool,
  isAskUserQuestionTool,
  isPushFileTool,
  isPlanModeTool,
  isPlanProposalTool,
  isInteractionTool,
  toolDisplayName,
} from '@zclaudia/agent-transcript-kit';
