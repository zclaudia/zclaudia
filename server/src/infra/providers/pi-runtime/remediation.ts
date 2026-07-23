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

export interface ToolFailureLoopRecovery {
  summary: string;
  nextTool?: string;
  steps: string[];
}

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

/** A concrete FS denial must beat the network classifier's verdict: the
 * classifier only recognizes network/bind denials, so it reads a pure FS write
 * denial as "ambiguous" and would steer the model away from the escalation
 * that actually fixes it. */
function sandboxFsDenialHint(details: NonNullable<ToolDetails>): string | undefined {
  if (details.sandboxFsDenied === 'write_outside_workspace') {
    return 'The Bash sandbox blocks file writes outside the workspace root. If the data can live in the workspace, re-run with a workspace-relative path (e.g. a scratch file at the repo root) or point the tool cache into the workspace. If the command legitimately needs host paths — home-directory caches such as ~/.npm or ~/.gradle, system locations, or device state — retry with sandbox_mode:"unsandboxed" and a concrete privilege_reason so the user can approve one-shot host execution.';
  }
  if (details.sandboxFsDenied === 'read_only') {
    return 'Plan mode runs Bash read-only — file writes are blocked. Use Read/Grep/Glob/LS to inspect; call ExitPlanMode first if the task genuinely needs to write.';
  }
  return undefined;
}

function bashHint(details: NonNullable<ToolDetails>): string | undefined {
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

function sandboxExecutionHint(details: NonNullable<ToolDetails>): string | undefined {
  if (details.sandboxInternalProxyDetected === true) {
    const urls = Array.isArray(details.sandboxInternalProxyUrls)
      ? details.sandboxInternalProxyUrls.filter((url): url is string => typeof url === 'string')
      : [];
    const urlText = urls.length ? ` (${urls.join(', ')})` : '';
    return `The localhost proxy${urlText} is the sandbox-runtime internal network proxy, not the user's proxy configuration. If the task needs host localhost access, local port binding, browser auth, or host credential agents, retry with sandbox_mode:"unsandboxed" and a concrete privilege_reason; otherwise request the specific sandbox capability for confirmed network denials.`;
  }
  const classification =
    typeof details.failureClassification === 'string' ? details.failureClassification : undefined;
  if (!classification) return undefined;
  const nextStep =
    typeof details.recommendedNextStep === 'string' ? details.recommendedNextStep : undefined;
  switch (classification) {
    case 'confirmed_sandbox_denial':
      return (
        nextStep ??
        'This is a confirmed sandbox denial. Request the specific sandbox capability rather than switching to unsandboxed execution.'
      );
    case 'probable_sandbox_denial':
      return (
        nextStep ??
        'This may be a sandbox denial, but evidence is incomplete. Collect one more diagnostic signal before requesting escalation.'
      );
    case 'ambiguous_failure':
      return (
        nextStep ??
        'Do not assume this failure is a permission issue. Inspect the command output and gather diagnostics before requesting sandbox escalation.'
      );
    default:
      return undefined;
  }
}

function pathArg(args: Record<string, unknown> | undefined): string | undefined {
  const value = args?.path ?? args?.file_path ?? args?.filePath;
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function isEditTool(toolName: string): boolean {
  return (
    toolName === 'Edit' ||
    toolName === 'MultiEdit' ||
    toolName === 'EditSymbol' ||
    toolName === 'Write'
  );
}

export function loopRecoveryForFailure(
  toolName: string,
  args: Record<string, unknown> | undefined,
  details: ToolDetails,
  attempts: number
): ToolFailureLoopRecovery | undefined {
  if (!details || details.ok !== false) return undefined;
  const code = typeof details.error === 'string' ? details.error : undefined;
  const path = pathArg(args);
  const pathText = path ? ` ${path}` : '';

  if (toolName === 'Edit' || toolName === 'MultiEdit') {
    switch (code) {
      case 'not_found':
        return {
          summary: `The same replacement text has been rejected ${attempts} times.`,
          nextTool: 'Read',
          steps: [
            `Read${pathText} again with hashline:true or a tight offset window.`,
            'Copy the current target text exactly, including whitespace and indentation.',
            toolName === 'Edit'
              ? 'If more replacements remain in this file, send them together with MultiEdit.'
              : 'Rebuild the MultiEdit edits array from the current file snapshot.',
          ],
        };
      case 'not_unique':
        return {
          summary: `The same ambiguous replacement has been rejected ${attempts} times.`,
          nextTool: toolName === 'Edit' ? 'MultiEdit' : 'Read',
          steps: [
            'Add enough surrounding context for each old_string to match once.',
            'Use replace_all:true only when every occurrence should change.',
            toolName === 'Edit'
              ? 'Use MultiEdit when applying several same-file replacements.'
              : 'Keep the MultiEdit array, but make each old_string unique.',
          ],
        };
      case 'hashline_mismatch':
      case 'hashline_tag_mismatch':
        return {
          summary: `The same stale hashline anchor has failed ${attempts} times.`,
          nextTool: 'Read',
          steps: [
            `Read${pathText} again with hashline:true to get fresh anchors.`,
            'Retry once with the new hashline_operation/hashline_tag pair.',
            'If the surrounding block changed structurally, switch to Write for that block or file.',
          ],
        };
      case 'invalid_edits':
        return {
          summary: `The MultiEdit schema has been rejected ${attempts} times.`,
          nextTool: 'MultiEdit',
          steps: [
            'Pass edits as an array of objects.',
            'Each edit must include old_string and new_string; replace_all is optional.',
            'Do not mix hashline_operation/hashline_line with edits[].',
          ],
        };
      default:
        break;
    }
  }

  if (toolName === 'ReadSymbol' || toolName === 'EditSymbol') {
    switch (code) {
      case 'symbol_not_found':
        return {
          summary: `The same symbol lookup failed ${attempts} times.`,
          nextTool: 'Grep',
          steps: [
            `Search${pathText} for the current function, method, class, or export name.`,
            'Use the qualified candidate name, for example ClassName.methodName.',
            'If this file type is unsupported, fall back to Read plus Edit or MultiEdit.',
          ],
        };
      case 'ambiguous_symbol':
        return {
          summary: `The same ambiguous symbol failed ${attempts} times.`,
          nextTool: 'ReadSymbol',
          steps: [
            'Choose one candidate from the ambiguity list.',
            'Call ReadSymbol with the fully qualified symbol name.',
            'Use that fresh bodyDigest if you proceed with EditSymbol.',
          ],
        };
      case 'stale_symbol':
        return {
          summary: `The same stale symbol digest failed ${attempts} times.`,
          nextTool: 'ReadSymbol',
          steps: [
            'Re-run ReadSymbol for the exact symbol.',
            'Use the returned bodyDigest as expected_body_digest.',
            'Retry EditSymbol once against that current symbol body.',
          ],
        };
      case 'unsupported_language':
        return {
          summary: `Symbol editing is not supported for this file after ${attempts} attempts.`,
          nextTool: 'Read',
          steps: [
            `Read${pathText} directly instead of using ReadSymbol/EditSymbol.`,
            'Use Edit or MultiEdit for exact replacements.',
            'Use Write if the change is a structured block rewrite.',
          ],
        };
      default:
        break;
    }
  }

  if (toolName === 'Write') {
    switch (code) {
      case 'file_modified_since_read':
      case 'file_not_read':
      case 'partial_read':
        return {
          summary: `The same guarded write failed ${attempts} times.`,
          nextTool: 'Read',
          steps: [
            `Read${pathText} fully to refresh the write guard snapshot.`,
            'Rebuild the final file content from the current snapshot.',
            'Call Write once with the complete intended content.',
          ],
        };
      default:
        break;
    }
  }

  if (isEditTool(toolName)) {
    return {
      summary: `The same editing attempt failed ${attempts} times.`,
      steps: [
        'Do not retry with identical inputs.',
        'Refresh the current file or symbol snapshot.',
        'Switch tools if the current primitive does not match the change shape: MultiEdit for same-file batches, EditSymbol for one supported symbol, or Write for a structural rewrite.',
      ],
    };
  }

  return undefined;
}

export function remediationForResult(toolName: string, details: ToolDetails): string | undefined {
  if (!details || details.ok !== false) return undefined;
  const code = typeof details.error === 'string' ? details.error : undefined;
  if (code && (SELF_EXPLANATORY.has(code) || code.endsWith('_loop_detected'))) return undefined;

  switch (code) {
    case 'symbol_not_found':
      return 'The requested symbol was not found. Use Grep or ReadSymbol with a qualified name such as ClassName.methodName to locate the current symbol before editing.';
    case 'ambiguous_symbol':
      return 'That symbol name matches multiple declarations. Re-run ReadSymbol with one of the qualified candidates, then edit the exact symbol.';
    case 'stale_symbol':
      return 'The symbol body changed since it was read. Re-run ReadSymbol for a fresh bodyDigest, then retry EditSymbol with the new expected_body_digest.';
    case 'unsupported_language':
      return 'ReadSymbol/EditSymbol only support Python, TypeScript, and JavaScript. Use Read plus Edit for this file type.';
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
    const fsHint = sandboxFsDenialHint(details);
    if (fsHint) return fsHint;
    const sandboxHint = sandboxExecutionHint(details);
    if (sandboxHint) return sandboxHint;
    const hint = bashHint(details);
    if (hint) return hint;
    if (
      details.fullOutputPath &&
      (details.timedOut === true ||
        (typeof details.exitCode === 'number' && details.exitCode !== 0))
    ) {
      return `The command failed; full output is at ${details.fullOutputPath} if the tail above is not enough.`;
    }
  }

  if (toolName === 'Eval') {
    const sandboxHint = sandboxExecutionHint(details);
    if (sandboxHint) return sandboxHint;
  }
  return undefined;
}
