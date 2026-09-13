import type { ServerMessage } from '@zclaudia/shared/wire/messages';
import type { ActiveRun } from '../transport/types.js';
import type { ProviderRuntimeEvent, SystemInfo } from '../../../infra/providers/types.js';
import { sessionInvocableCatalogService } from '../../invocations/session-catalog.js';

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
        modelId: msg.systemInfo.modelId,
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
    // Atomic binding (§14.3): the provider session id and its transport are
    // committed together, before this run's adapter resumes (which is when
    // the first prompt is submitted). A resume with a different transport is
    // never attempted.
    const transport = (msg as { providerTransport?: string }).providerTransport;
    if (transport) {
      db.prepare(
        `
          UPDATE sessions SET sdk_session_id = ?, provider_transport = ?, updated_at = ? WHERE id = ?
        `
      ).run(state.sdkSessionId, transport, Date.now(), sessionId);
    } else {
      db.prepare(
        `
          UPDATE sessions SET sdk_session_id = ?, updated_at = ? WHERE id = ?
        `
      ).run(state.sdkSessionId, Date.now(), sessionId);
    }

    activeRun.providerSessionId = state.sdkSessionId;

    sendRunEvent({
      type: 'session_created',
      sessionId,
      sdkSessionId: msg.sessionId,
    });
    sessionInvocableCatalogService.invalidateSession(sessionId);
    sendRunEvent({
      type: 'invocable_catalog_changed',
      sessionId,
      revision: 'pending-refresh',
      reason: 'runtime-initialized',
    });
  }
}
