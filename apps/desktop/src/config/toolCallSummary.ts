import type { ToolCallState } from '../stores/runStore';
import {
  isTodoTool,
  isAskUserFormTool,
  isApprovalTool,
  isPushFileTool,
  isPlanProposalTool,
} from '@zclaudia/agent-transcript-kit';

// Normalize tool input: some providers send stringified JSON instead of objects
export function normalizeToolInput(input: unknown): unknown {
  if (typeof input === 'string') {
    try {
      return JSON.parse(input);
    } catch {
      return input;
    }
  }
  return input;
}

/** A short summary of what a tool call did, for compact chips and step rows. */
export function getToolCallSummary(tc: ToolCallState): string {
  const input = normalizeToolInput(tc.toolInput) as Record<string, unknown> | undefined;
  if (!input) return tc.toolName;

  // Handle MCP interaction tools before switch
  if (isTodoTool(tc.toolName)) {
    return 'Update todos';
  }
  if (isAskUserFormTool(tc.toolName)) {
    return String(input.title || 'Form').substring(0, 20);
  }
  if (isApprovalTool(tc.toolName)) {
    return String(input.title || 'Approval').substring(0, 20);
  }
  if (isPushFileTool(tc.toolName)) {
    const fp = String(input.filePath || '');
    return fp ? fp.split('/').pop()! : 'Push file';
  }

  // Plan-mode tools: semantic-driven so we don't hardcode provider tool names.
  if (tc.semantic === 'plan_enter') return 'Enter plan mode';
  if (tc.semantic === 'plan_exit') return 'Exit plan mode';
  if (isPlanProposalTool(tc.toolName, tc.semantic)) {
    let planText = '';
    if (input.plan) {
      planText = typeof input.plan === 'string' ? input.plan : JSON.stringify(input.plan);
    } else if (input.plan_file && typeof input.plan_file === 'string') {
      planText = input.plan_file;
    } else if (Object.keys(input).length > 0) {
      planText = JSON.stringify(input);
    }
    const title =
      planText
        .split('\n')
        .find(l => l.trim())
        ?.replace(/^#+\s*/, '') || 'Plan';
    return title.substring(0, 25);
  }

  switch (tc.toolName) {
    case 'Read':
      return input.file_path ? String(input.file_path).split('/').pop()! : 'Read';
    case 'ReadSymbol': {
      const filePath = String(input.file_path ?? input.path ?? '');
      const fileName = filePath ? filePath.split('/').pop()! : 'ReadSymbol';
      const symbol = String(input.symbol ?? '');
      return symbol ? `${fileName}#${symbol}` : fileName;
    }
    case 'Write':
      return input.file_path ? String(input.file_path).split('/').pop()! : 'Write';
    case 'Edit':
      return input.file_path ? String(input.file_path).split('/').pop()! : 'Edit';
    case 'MultiEdit': {
      const filePath = String(input.file_path ?? input.path ?? '');
      const fileName = filePath ? filePath.split('/').pop()! : 'MultiEdit';
      const count = Array.isArray(input.edits) ? input.edits.length : 0;
      return `${fileName} | ${count} edits`;
    }
    case 'EditSymbol': {
      const filePath = String(input.file_path ?? input.path ?? '');
      const fileName = filePath ? filePath.split('/').pop()! : 'EditSymbol';
      const symbol = String(input.symbol ?? '');
      return symbol ? `${fileName}#${symbol}` : fileName;
    }
    case 'RenameSymbol': {
      const symbol = String(input.symbol ?? '');
      const newName = String(input.new_name ?? '');
      return symbol && newName ? `${symbol} → ${newName}` : 'RenameSymbol';
    }
    case 'Bash': {
      const cmd = String(input.command || '').split(' ')[0];
      return cmd || 'bash';
    }
    case 'Grep':
      return `grep ${String(input.pattern || '').substring(0, 15)}`;
    case 'Glob':
      return `glob ${String(input.pattern || '').substring(0, 15)}`;
    case 'Task':
      return String(input.description || 'task').substring(0, 20);
    case 'WebFetch':
      try {
        const url = new URL(String(input.url || ''));
        return url.hostname;
      } catch {
        return 'fetch';
      }
    case 'WebSearch':
      return String(input.query || '').substring(0, 15);
    case 'AskUserQuestion': {
      const questions = (input.questions as Array<{ header: string }>) || [];
      return questions[0]?.header || 'question';
    }
    default:
      return tc.toolName;
  }
}
