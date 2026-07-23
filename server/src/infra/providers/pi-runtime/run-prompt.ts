export const PLAN_MODE_SYSTEM_PROMPT_SUFFIX =
  '\n\nYou are in PLAN mode. Produce a concrete plan for the user to review and approve. ' +
  'Do not modify files or execute side-effecting commands; only read-only or clarification tools are available. ' +
  'Once the plan is ready, end your turn and wait for the user to confirm before executing anything.';

export const EDIT_TOOL_SELECTION_GUIDANCE = [
  '# Editing Tool Selection',
  'Use the narrowest editing tool that matches the change:',
  '- Use MultiEdit for two or more exact replacements in the same file; put all replacements in one edits array so the tool can apply them atomically.',
  '- Use ReadSymbol before EditSymbol when changing one function, method, class, or exported variable in Python, TypeScript, or JavaScript. Pass expected_body_digest from ReadSymbol to EditSymbol.',
  '- Use Read with hashline:true plus Edit hashline_operation when line-level anchors may have drifted or line numbers are unreliable.',
  '- Use Write for full-file rewrites or structurally sensitive blocks such as JSON arrays, Markdown tables, YAML, TOML, or generated structured sections.',
  '- After a successful Write, Edit, MultiEdit, or EditSymbol result, rely on its diff and updated snapshot; do not call Read again only to verify the change.',
].join('\n');

export const SANDBOX_PRIVILEGE_SELECTION_GUIDANCE = [
  '# Sandbox Privilege Selection',
  'Bash and Eval normally run in a sandbox on the user\'s own machine — not a remote container. Unsandboxed execution runs on that same host with full access to host-installed toolchains and SDKs, connected devices (for example USB/adb), keychains, and home-directory caches. Never conclude a task is impossible because of sandbox restrictions without first attempting it with sandbox_mode:"unsandboxed" and a privilege_reason — the user approves or denies each request.',
  'Prefer sandbox_mode:"auto" for ordinary commands: the runtime will request least-privilege SandboxCapabilityAccess only after confirmed sandbox denials.',
  'Use sandbox_mode:"unsandboxed" with a concrete privilege_reason when the task is known before execution to require host integration that the sandbox cannot provide.',
  'Host-only examples include: bind a localhost port for a dev server or proxy (for example uvicorn --host 127.0.0.1 --port ...), open or complete browser-based login flows such as AWS SSO, run aws sso / credential commands, interact with host credential agents/keychains, or reach services/devices only available from the user host.',
  "If Bash or Eval output shows http_proxy=http://localhost:<port>, HTTP_PROXY=http://localhost:<port>, or similar localhost proxy variables while sandboxed, treat that as the sandbox-runtime internal network proxy, not as the user's proxy configuration.",
  'Do not ask the user to run commands in their terminal merely because host integration is needed. Call Bash or Eval with sandbox_mode:"unsandboxed" and privilege_reason so the user can approve or deny the one-shot host execution.',
  'Do not use unsandboxed for vague failures. If a sandboxed command fails ambiguously, inspect output or gather diagnostics first; use capability grants for confirmed sandbox denials.',
].join('\n');

export interface PiRunPromptBundle {
  effectiveSystemPrompt: string;
  snapshotSystemPromptText: string;
  snapshotSkillCatalogText: string;
}

function appendPromptBlock(prompt: string, block: string | undefined): string {
  const text = block?.trim();
  if (!text) return prompt;
  return prompt ? `${prompt}\n\n${text}` : text;
}

/**
 * Render the currently-connected MCP servers' instructions as a system-prompt
 * block. Route C: the context tree no longer carries the old delta-in-history
 * MCP notices, so the model would otherwise never see MCP server instructions.
 * Injecting the CURRENT full set each turn (rather than a one-time delta) is
 * also compaction-robust — a delta message can be summarized away once it falls
 * before a compaction boundary; the system prompt never is. Returns '' when no
 * connected server has instructions, so a stable (no-MCP) prompt prefix is
 * unchanged and stays cache-friendly.
 */
export function formatMcpInstructionsForPrompt(
  sources: Array<{ name: string; instructions: string }>
): string {
  const usable = sources.filter(s => s.instructions?.trim());
  if (usable.length === 0) return '';
  const sections = usable.map(s => `## ${s.name}\n${s.instructions.trim()}`);
  return [
    '# MCP Server Instructions',
    'The following MCP servers have provided instructions for how to use their tools and resources:',
    ...sections,
  ].join('\n\n');
}

export function buildPiRunPrompt(input: {
  systemPrompt?: string;
  externalProviderCatalog: string;
  skillCatalog: string;
  activeSkillContext: string;
  isPlanMode: boolean;
  mcpInstructions?: string;
}): PiRunPromptBundle {
  const {
    systemPrompt,
    externalProviderCatalog,
    skillCatalog,
    activeSkillContext,
    isPlanMode,
    mcpInstructions,
  } = input;
  const externalToolsPrompt = externalProviderCatalog
    ? `${externalProviderCatalog}\nUse SearchExternalTools and InspectExternalTool before loading external tools. LoadExternalTool only makes a tool available in this session; execution may still require permission.`
    : '';
  let baseSystemPrompt = appendPromptBlock(systemPrompt ?? '', EDIT_TOOL_SELECTION_GUIDANCE);
  baseSystemPrompt = appendPromptBlock(baseSystemPrompt, SANDBOX_PRIVILEGE_SELECTION_GUIDANCE);
  baseSystemPrompt = appendPromptBlock(baseSystemPrompt, externalToolsPrompt);
  baseSystemPrompt = appendPromptBlock(baseSystemPrompt, skillCatalog);
  baseSystemPrompt = appendPromptBlock(baseSystemPrompt, activeSkillContext);
  baseSystemPrompt = appendPromptBlock(baseSystemPrompt, mcpInstructions);

  const effectiveSystemPrompt = isPlanMode
    ? baseSystemPrompt + PLAN_MODE_SYSTEM_PROMPT_SUFFIX
    : baseSystemPrompt;
  let snapshotSystemPromptText = appendPromptBlock(
    systemPrompt ?? '',
    EDIT_TOOL_SELECTION_GUIDANCE
  );
  snapshotSystemPromptText = appendPromptBlock(
    snapshotSystemPromptText,
    SANDBOX_PRIVILEGE_SELECTION_GUIDANCE
  );
  snapshotSystemPromptText = appendPromptBlock(snapshotSystemPromptText, externalProviderCatalog);
  snapshotSystemPromptText = appendPromptBlock(snapshotSystemPromptText, mcpInstructions);

  return {
    effectiveSystemPrompt,
    snapshotSystemPromptText:
      snapshotSystemPromptText + (isPlanMode ? PLAN_MODE_SYSTEM_PROMPT_SUFFIX : ''),
    // Join like appendPromptBlock does — a bare concat would glue the catalog's
    // last line onto the context's first (snapshot/cache-audit text only).
    snapshotSkillCatalogText: [skillCatalog, activeSkillContext].filter(Boolean).join('\n'),
  };
}
