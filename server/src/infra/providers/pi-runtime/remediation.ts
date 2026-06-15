/**
 * Auto-fix remediation hints.
 *
 * pi-agent-core has no tool re-invocation hook, so "auto-fix" here means:
 * detect a recognizable tool failure and append one concrete next step to the
 * result the model sees, so it self-corrects on the next turn instead of
 * blindly retrying. Hints are intentionally terse and only fire for known,
 * actionable error codes — unknown failures are left untouched.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ToolDetails = Record<string, any> | undefined;

/** Error codes that already carry their own escalation/guidance — don't pile on. */
const SELF_EXPLANATORY = new Set([
  'edit_loop_detected',
  'tool_loop_detected',
  'critical_command_blocked',
  'auto_background_failed',
  'missing_command',
  'missing_path',
  'missing_code',
  'missing_pattern',
  'missing_prompt',
  'bash_tool_routing_blocked',
]);

function bashHint(details: NonNullable<ToolDetails>): string | undefined {
  if (details.sandboxFsDenied === 'write_outside_workspace') {
    return 'The Bash sandbox blocks file writes outside the workspace root. Re-run with a workspace-relative path (e.g. a scratch file at the repo root); or pipe the data straight to the next step instead of staging it in /tmp.';
  }
  if (details.sandboxFsDenied === 'read_only') {
    return 'Plan mode runs Bash read-only — file writes are blocked. Use Read/Grep/Glob/LS to inspect; call ExitPlanMode first if the task genuinely needs to write.';
  }
  if (details.exitCode === 127) {
    return 'Exit 127 usually means the command was not found — check the name, or that the tool is installed and on PATH.';
  }
  if (details.exitCode === 126) {
    return 'Exit 126 means the target is not executable — check permissions (chmod +x) or that it is the right file.';
  }
  if (details.timedOut === true) {
    return 'The command timed out. Re-run with run_in_background:true for long tasks, or raise the timeout if it legitimately needs longer.';
  }
  return undefined;
}

export function remediationForResult(toolName: string, details: ToolDetails): string | undefined {
  if (!details || details.ok !== false) return undefined;
  const code = typeof details.error === 'string' ? details.error : undefined;
  if (code && (SELF_EXPLANATORY.has(code) || code.endsWith('_loop_detected'))) return undefined;

  switch (code) {
    case 'not_found':
      return 'The exact old_string was not found. Read the file again and copy the target text verbatim — watch for whitespace, indentation, and quote-style differences.';
    case 'not_unique':
      return 'old_string matches multiple places. Add surrounding context to make it unique, or pass replace_all:true to change every occurrence.';
    case 'hashline_mismatch':
    case 'hashline_tag_mismatch':
      return 'The hashline anchor no longer matches. Read the file again with hashline:true to get fresh anchors before editing.';
    case 'file_modified_since_read':
      return 'The file changed since you last read it. Read it again, then re-apply your edit against the current content.';
    case 'file_not_read':
    case 'partial_read':
      return 'Read the full file before editing or overwriting it.';
    case 'path_outside_workspace':
      return 'Use a workspace-relative path that stays inside the workspace root.';
    case 'auto_generated_file':
      return 'This file is auto-generated. Edit the source or generator config instead, then regenerate.';
    case 'binary_file':
      return 'This is a binary file. Use a tool suited to its format rather than reading it as text.';
    case 'cwd_not_found':
      return 'The working directory does not exist. Create it first or use an existing path.';
    case 'not_a_file':
      return 'The path is a directory, not a file. Use LS to inspect it or point at a file inside it.';
    default:
      break;
  }

  if (toolName === 'Bash') {
    const hint = bashHint(details);
    if (hint) return hint;
    if (details.fullOutputPath && (details.timedOut === true || (typeof details.exitCode === 'number' && details.exitCode !== 0))) {
      return `The command failed; full output is at ${details.fullOutputPath} if the tail above is not enough.`;
    }
  }
  return undefined;
}
