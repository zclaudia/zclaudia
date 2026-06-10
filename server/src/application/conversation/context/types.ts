/**
 * Context Engine types — system prompt content management.
 *
 * Context Engine decides "what to inject" into system prompt.
 * Run-handler decides "how to inject" (via RunOptions.systemPrompt).
 */

export interface AssemblyInput {
  // Project / session context
  projectId?: string;
  sessionId: string;
  cwd?: string;

  /**
   * Agent profile system prompt (§4.6 full replacement): replaces the
   * template's built-in persona prompt and leads the assembled output, with
   * workspace/context sections appended after it. Must be stable per session —
   * it forms the prompt-cache prefix (pi-ai marks the system prompt with
   * cache_control).
   */
  baseSystemPrompt?: string;

  // Memory context (from Layer 2, for agent mode)
  memoryContext?: string;

  // Prompt fragments from run-handler (coding mode)
  workspacePrompt?: string;
  skillDirectoryHint?: string;
  systemContext?: string;
  nonNativePlanPrompt?: string;
  planDocumentPrompt?: string;
  filePushContext?: string;
  interactionToolPrompt?: string;
  sessionSystemPrompt?: string;
}

export type ContextTemplate = 'coding' | 'agent' | 'supervision' | 'review' | 'debug';

export const CONTEXT_TEMPLATES: ContextTemplate[] = ['coding', 'agent', 'supervision', 'review', 'debug'];

export interface ContextEngine {
  assemble(template: ContextTemplate, input: AssemblyInput): string;
}
