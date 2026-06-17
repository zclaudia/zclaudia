import type { ServerMessage } from '@zclaudia/shared/wire/messages';
import type { ActiveRun } from '../transport/types.js';
import type { ProviderRuntimeEvent, SystemInfo } from '../../../infra/providers/types.js';

export interface ProviderSessionState {
  sdkSessionId?: string;
  systemInfo?: SystemInfo;
}

export interface HandleProviderInitInput {
  activeRun: ActiveRun;
  db: ActiveRun['db'];
  msg: ProviderRuntimeEvent;
  persistSessionWorkingDirectory: (nextWorkingDirectory: string | null | undefined) => void;
  runId: string;
  sendRunEvent: (event: ServerMessage) => void;
  sessionId: string;
  state: ProviderSessionState;
}

export function handleProviderInit(input: HandleProviderInitInput): void {
  const {
    activeRun,
    db,
    msg,
    persistSessionWorkingDirectory,
    runId,
    sendRunEvent,
    sessionId,
    state,
  } = input;

  if (msg.systemInfo) {
    state.systemInfo = msg.systemInfo;
    activeRun.latestSystemInfo = msg.systemInfo;
    persistSessionWorkingDirectory(msg.systemInfo.cwd);
    sendRunEvent({
      type: 'system_info',
      runId,
      systemInfo: {
        model: msg.systemInfo.model,
        contextWindow: msg.systemInfo.contextWindow,
        contextWindowSource: msg.systemInfo.contextWindowSource,
        contextWindowMatchedProvider: msg.systemInfo.contextWindowMatchedProvider,
        claudeCodeVersion: msg.systemInfo.claudeCodeVersion,
        cwd: msg.systemInfo.cwd,
        permissionMode: msg.systemInfo.permissionMode,
        apiKeySource: msg.systemInfo.apiKeySource,
        tools: msg.systemInfo.tools,
        mcpServers: msg.systemInfo.mcpServers,
        slashCommands: msg.systemInfo.slashCommands,
        agents: msg.systemInfo.agents,
      },
    });
  }

  if (msg.sessionId && msg.sessionId !== state.sdkSessionId) {
    state.sdkSessionId = msg.sessionId;
    db.prepare(`
          UPDATE sessions SET sdk_session_id = ?, updated_at = ? WHERE id = ?
        `).run(state.sdkSessionId, Date.now(), sessionId);

    activeRun.providerSessionId = state.sdkSessionId;

    sendRunEvent({
      type: 'session_created',
      sessionId,
      sdkSessionId: msg.sessionId,
    });
  }
}
