import type {
  AgentPlaygroundServerMessage,
  AgentPlaygroundStatus,
} from '@zclaudia/shared/plugins/agent-playground';
import type { ProviderRuntimeEvent } from '@zclaudia/shared/providers';

type PermissionRequest = Extract<
  AgentPlaygroundServerMessage,
  { type: 'permission_request' }
>['request'];

export interface PlaygroundMessage {
  id: string;
  runId: string;
  role: 'user' | 'assistant';
  content: string;
  thinking: string;
  error?: string;
}

export interface PlaygroundToolCall {
  id: string;
  runId: string;
  name: string;
  input?: unknown;
  result?: unknown;
  status: 'running' | 'completed' | 'error';
}

export interface PlaygroundPermission {
  runId: string;
  request: PermissionRequest;
}

export interface AgentPlaygroundState {
  status: AgentPlaygroundStatus | null;
  connected: boolean;
  messages: PlaygroundMessage[];
  tools: PlaygroundToolCall[];
  permissions: PlaygroundPermission[];
  events: AgentPlaygroundServerMessage[];
  logs: Extract<AgentPlaygroundServerMessage, { type: 'plugin_log' }>[];
  activeRunIds: string[];
  lastSequence: number;
  sessionId?: string;
  error?: string;
}

export type AgentPlaygroundAction =
  | { type: 'connection'; connected: boolean }
  | { type: 'status_loaded'; status: AgentPlaygroundStatus }
  | { type: 'server'; message: AgentPlaygroundServerMessage }
  | { type: 'clear_inspector' }
  | { type: 'new_session' }
  | { type: 'error'; error?: string };

export const initialAgentPlaygroundState: AgentPlaygroundState = {
  status: null,
  connected: false,
  messages: [],
  tools: [],
  permissions: [],
  events: [],
  logs: [],
  activeRunIds: [],
  lastSequence: 0,
};

function upsertAssistant(
  messages: PlaygroundMessage[],
  runId: string,
  patch: (message: PlaygroundMessage) => PlaygroundMessage
): PlaygroundMessage[] {
  const index = messages.findIndex(
    message => message.runId === runId && message.role === 'assistant'
  );
  if (index < 0) {
    return [
      ...messages,
      patch({
        id: `assistant-${runId}`,
        runId,
        role: 'assistant',
        content: '',
        thinking: '',
      }),
    ];
  }
  return messages.map((message, messageIndex) =>
    messageIndex === index ? patch(message) : message
  );
}

function applyRuntimeEvent(
  state: AgentPlaygroundState,
  runId: string,
  event: ProviderRuntimeEvent
): AgentPlaygroundState {
  if (event.type === 'init' && event.sessionId) return { ...state, sessionId: event.sessionId };
  if (event.type === 'assistant_delta' || event.type === 'assistant') {
    return {
      ...state,
      messages: upsertAssistant(state.messages, runId, message => ({
        ...message,
        content: message.content + (event.content ?? ''),
      })),
    };
  }
  if (event.type === 'thinking_delta') {
    return {
      ...state,
      messages: upsertAssistant(state.messages, runId, message => ({
        ...message,
        thinking: message.thinking + (event.thinkingContent ?? ''),
      })),
    };
  }
  if (event.type === 'tool_started' || event.type === 'tool_use') {
    const toolId = event.toolUseId ?? `${runId}-tool-${state.tools.length}`;
    return {
      ...state,
      tools: [
        ...state.tools.filter(tool => tool.id !== toolId),
        {
          id: toolId,
          runId,
          name: event.toolName ?? 'Tool',
          input: event.toolInput,
          status: 'running',
        },
      ],
    };
  }
  if (event.type === 'tool_finished' || event.type === 'tool_result') {
    const toolId = event.toolUseId;
    if (!toolId) return state;
    return {
      ...state,
      tools: state.tools.map(tool =>
        tool.id === toolId
          ? {
              ...tool,
              result: event.toolResult,
              status: event.isToolError ? 'error' : 'completed',
            }
          : tool
      ),
    };
  }
  if (event.type === 'provider_error' || event.type === 'error') {
    return {
      ...state,
      messages: upsertAssistant(state.messages, runId, message => ({
        ...message,
        error: event.error ?? 'Provider error',
      })),
    };
  }
  return state;
}

export function agentPlaygroundReducer(
  state: AgentPlaygroundState,
  action: AgentPlaygroundAction
): AgentPlaygroundState {
  if (action.type === 'connection') return { ...state, connected: action.connected };
  if (action.type === 'status_loaded') {
    return {
      ...state,
      status: action.status,
      activeRunIds: action.status.activeRunIds,
    };
  }
  if (action.type === 'error') return { ...state, error: action.error };
  if (action.type === 'clear_inspector') {
    return { ...state, events: [], logs: [] };
  }
  if (action.type === 'new_session') {
    return {
      ...state,
      sessionId: undefined,
      messages: [],
      tools: [],
      permissions: [],
      events: [],
      error: undefined,
    };
  }
  const message = action.message;
  if (message.sequence !== undefined && message.sequence <= state.lastSequence) return state;
  const nextEvents = [...state.events, message].slice(-500);
  const next: AgentPlaygroundState = {
    ...state,
    events: nextEvents,
    lastSequence: message.sequence ?? state.lastSequence,
  };
  switch (message.type) {
    case 'status':
    case 'plugin_reloaded':
      return {
        ...next,
        status: message.status,
        activeRunIds: message.status.activeRunIds,
      };
    case 'plugin_log':
      return { ...next, logs: [...state.logs, message].slice(-300) };
    case 'run_started': {
      const hasConversation = state.messages.some(item => item.runId === message.runId);
      return {
        ...next,
        error: undefined,
        activeRunIds: state.activeRunIds.includes(message.runId)
          ? state.activeRunIds
          : [...state.activeRunIds, message.runId],
        messages: hasConversation
          ? state.messages
          : [
              ...state.messages,
              {
                id: `user-${message.runId}`,
                runId: message.runId,
                role: 'user',
                content: message.request.input,
                thinking: '',
              },
              {
                id: `assistant-${message.runId}`,
                runId: message.runId,
                role: 'assistant',
                content: '',
                thinking: '',
              },
            ],
      };
    }
    case 'runtime_event':
      return { ...applyRuntimeEvent(next, message.runId, message.event), events: nextEvents };
    case 'permission_request':
      return {
        ...next,
        permissions: [
          ...state.permissions.filter(
            permission => permission.request.requestId !== message.request.requestId
          ),
          { runId: message.runId, request: message.request },
        ],
      };
    case 'permission_resolved':
      return {
        ...next,
        permissions: state.permissions.filter(
          permission => permission.request.requestId !== message.requestId
        ),
      };
    case 'run_finished':
      return {
        ...next,
        sessionId: message.sessionId ?? state.sessionId,
        activeRunIds: state.activeRunIds.filter(runId => runId !== message.runId),
      };
    case 'run_failed':
      return {
        ...next,
        activeRunIds: state.activeRunIds.filter(runId => runId !== message.runId),
        messages: upsertAssistant(state.messages, message.runId, assistant => ({
          ...assistant,
          error: message.error,
        })),
      };
  }
}
