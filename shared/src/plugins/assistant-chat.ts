/**
 * Reserved backend-facing contract for an external chat connector (e.g. zpet).
 * A future adapter can expose this with PluginContext.exports/getPluginAPI.
 * These types do not install a transport or add unimplemented PluginContext APIs.
 */
export interface AssistantChatContext {
  backendId: string;
  projectId?: string;
  sessionId?: string;
}

export interface AssistantChatRequest {
  /** Stable producer-generated ID for correlating a streamed response. */
  requestId: string;
  context: AssistantChatContext;
  text: string;
}

export interface AssistantChatTask {
  id: string;
  context: AssistantChatContext;
  title: string;
  status: 'queued' | 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled';
  updatedAt: number;
  summary?: string;
  error?: string;
}

export type AssistantChatEvent =
  | { type: 'text-delta'; requestId: string; text: string }
  | { type: 'task'; requestId: string; task: AssistantChatTask }
  | { type: 'completed'; requestId: string }
  | { type: 'failed'; requestId: string; message: string };

export interface AssistantChatPluginAPI {
  readonly version: 1;
  /** Stream ends with completed/failed; task completion is tracked separately. */
  sendMessage(request: AssistantChatRequest): AsyncIterable<AssistantChatEvent>;
  /** Current tasks for initial load and reconnect recovery. */
  listTasks(context: AssistantChatContext): Promise<AssistantChatTask[]>;
  onTaskChanged(
    context: AssistantChatContext,
    handler: (task: AssistantChatTask) => void
  ): () => void;
  cancelTask(context: AssistantChatContext, taskId: string): Promise<void>;
  /** Return to the owning application's session UI, including pending approvals. */
  openSession(context: AssistantChatContext & { sessionId: string }): Promise<void>;
}
