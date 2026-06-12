// Message Types

export type MessageRole = 'user' | 'assistant' | 'system';

// File attachment reference (uses fileId instead of embedded base64)
export interface MessageAttachment {
  fileId: string;        // Reference to uploaded file
  name: string;          // Original filename
  mimeType: string;      // MIME type
  type: 'image' | 'file'; // Attachment type
}

// Structured message input (for messages with attachments)
export interface MessageInput {
  text: string;
  attachments?: MessageAttachment[];
}

export interface Message {
  id: string;
  sessionId: string;
  role: MessageRole;
  content: string;
  metadata?: MessageMetadata;
  createdAt: number;
  offset?: number;  // Per-session sequential message number (for gap detection)
}

export type ContentBlock =
  | { type: 'text'; content: string }
  | { type: 'tool_use'; toolUseId: string }
  | { type: 'thinking'; content: string; signature?: string };

export interface ThinkingBlock {
  text: string;
  signature?: string;
  redacted?: boolean;
}

export interface FileChangeEffectFile {
  path: string;
  changeKind?: 'add' | 'modify' | 'delete' | 'rename' | 'unknown';
  summary?: string;
}

export type ToolEffect =
  | {
      kind: 'file_change';
      files: FileChangeEffectFile[];
    }
  | {
      kind: 'shell';
      command: string;
    };

export interface MessageMetadata {
  toolCalls?: ToolCall[];
  contentBlocks?: ContentBlock[];
  usage?: UsageInfo;
  filePush?: FilePushMetadata;
  thinkingBlocks?: ThinkingBlock[];
  /** True when this user message was injected mid-run via steering (vs. normal user send). */
  steered?: boolean;
  /** Attachment refs for user messages; images are lazily re-resolved from
   * the file store when history is rebuilt. */
  attachments?: MessageAttachment[];
  /**
   * Set on synthetic system messages that represent a compaction event in the timeline.
   * The renderer detects this and replaces the default system-message bubble with a
   * dedicated CompactionMarkerCard. These messages are NOT persisted in the messages
   * table — the sessions messages-list endpoint synthesizes them from the
   * session_compactions table and interleaves by createdAt.
   */
  compactionMarker?: CompactionMarker;
  /**
   * Set on synthetic, frontend-only system messages produced by the /context
   * command. MessageList renders a ContextUsageCard instead of the default
   * system bubble. Never persisted.
   */
  contextUsage?: ContextUsagePayload;
}

/**
 * Timeline-entry view of a session_compactions row. The wire-level event
 * `compaction_completed` carries only ids; the marker (which the UI cards)
 * is fetched separately from `GET /api/sessions/:sid/compactions/:cid`
 * and injected into the messages list by the server.
 */
export interface CompactionMarker {
  compactionId: string;
  summary: string;
  tokensBefore: number;
  source: 'auto' | 'manual';
  customInstructions?: string;
  readFiles: string[];
  modifiedFiles: string[];
  createdAt: number;
}

/**
 * One category row in the /context breakdown. `estimated` marks values
 * derived from estimation rather than real token counts.
 */
export interface ContextUsageBreakdownEntry {
  tokens: number;
  estimated: boolean;
}

/**
 * One category in the /context breakdown. Residual: usedTokens − (systemPrompt + tools + skills),
 * clamped ≥ 0. `clamped` is true when the raw residual was negative (estimate overshoot),
 * so the UI can flag estimation error.
 */
export interface ContextUsageBreakdown {
  systemPrompt: ContextUsageBreakdownEntry;
  tools: ContextUsageBreakdownEntry & { count: number };
  skills: ContextUsageBreakdownEntry;
  messages: ContextUsageBreakdownEntry & { clamped: boolean };
  freeSpace: { tokens: number; percent: number };
}

/**
 * Payload for the `/context` command card. Attached to a synthetic,
 * frontend-only system message via `metadata.contextUsage`; never persisted.
 * Produced by the server from the per-run context snapshot
 * (see server `infra/providers/context-snapshot.ts`).
 */
export interface ContextUsagePayload {
  model: string;
  /** Effective context window in tokens. */
  contextWindow: number;
  /** Vocabulary mirrors wire ContextWindowSource (wire/messages/core.ts); typed string to avoid a core/ → wire/ import. */
  contextWindowSource: string;
  /** Real occupancy (lastUsage.input + cacheRead) when available; falls back
   *  to the estimate sum when the first run hasn't completed yet. */
  usedTokens: number;
  /** True when usedTokens comes from real usage rather than estimates. */
  usedTokensFromUsage: boolean;
  breakdown: ContextUsageBreakdown;
  capturedAt: number;
}

export interface FilePushMetadata {
  fileId: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  description?: string;
  autoDownload: boolean;
}

export interface ToolCall {
  toolUseId?: string;
  name: string;
  input: unknown;
  output?: unknown;
  isError?: boolean;
  effect?: ToolEffect;
}

export interface UsageCost {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
}

export interface UsageInfo {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost: UsageCost;
}

// Note: ToolDefinition and AIToolCall are defined in plugin-types.ts
