import type {
  AgentPlaygroundPermissionDecisionRequest,
  AgentPlaygroundRunAccepted,
  AgentPlaygroundRunRequest,
  AgentPlaygroundServerMessage,
  AgentPlaygroundStatus,
} from '@zclaudia/shared/plugins/agent-playground';

const SERVER_URL =
  (import.meta.env.VITE_AGENT_PLAYGROUND_SERVER_URL as string | undefined) ??
  'http://127.0.0.1:4310';
const TOKEN = (import.meta.env.VITE_AGENT_PLAYGROUND_TOKEN as string | undefined) ?? '';

function socketUrl(): string {
  const url = new URL('/events', SERVER_URL);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('token', TOKEN);
  return url.toString();
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(new URL(path, SERVER_URL), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-Agent-Playground-Token': TOKEN,
      ...init?.headers,
    },
  });
  const body = (await response.json().catch(() => ({}))) as { error?: string } & T;
  if (!response.ok) throw new Error(body.error || `Playground request failed: ${response.status}`);
  return body;
}

export const agentPlaygroundApi = {
  status: () => request<AgentPlaygroundStatus>('/api/status'),
  run: (input: AgentPlaygroundRunRequest) =>
    request<AgentPlaygroundRunAccepted>('/api/runs', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  abort: (runId: string) =>
    request<{ aborted: boolean }>(`/api/runs/${encodeURIComponent(runId)}/abort`, {
      method: 'POST',
    }),
  decidePermission: (decision: AgentPlaygroundPermissionDecisionRequest) =>
    request<{ resolved: boolean }>(`/api/permissions/${encodeURIComponent(decision.requestId)}`, {
      method: 'POST',
      body: JSON.stringify(decision),
    }),
  setMode: (sessionId: string, mode: string) =>
    request<{ changed: boolean }>(`/api/sessions/${encodeURIComponent(sessionId)}/mode`, {
      method: 'POST',
      body: JSON.stringify({ mode }),
    }),
  reload: () => request<AgentPlaygroundStatus>('/api/reload', { method: 'POST' }),
};

export function connectAgentPlayground(
  onMessage: (message: AgentPlaygroundServerMessage) => void,
  onConnectionChange: (connected: boolean) => void
): () => void {
  let stopped = false;
  let socket: WebSocket | null = null;
  let reconnectTimer: number | null = null;

  const connect = () => {
    if (stopped) return;
    socket = new WebSocket(socketUrl());
    socket.addEventListener('open', () => onConnectionChange(true));
    socket.addEventListener('message', event => {
      try {
        onMessage(JSON.parse(String(event.data)) as AgentPlaygroundServerMessage);
      } catch {
        // Ignore malformed development messages and keep the socket alive.
      }
    });
    socket.addEventListener('close', () => {
      onConnectionChange(false);
      if (!stopped) reconnectTimer = window.setTimeout(connect, 750);
    });
  };

  connect();
  return () => {
    stopped = true;
    if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
    socket?.close();
  };
}
