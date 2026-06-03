import { processAtMentions } from '../../../utils/server-utils.js';
import { createPermissionCallback } from './run-permissions.js';
import type { RunStartMessage, RunSessionRecord } from './run-bootstrap.js';
import type { ActiveRun, ConnectedClient } from '../transport/types.js';
import type { NotificationSender } from '../../../infra/push/notification-sender.js';
import type { LlmProfileConfig } from '@zclaudia/shared/core/llm-profile';
import type { PermissionBridge } from '../agent/permission-bridge.js';
import type { PermissionWorkflowResolver } from '../../../domains/workflows/index.js';

interface PrepareProviderRunInput {
  activeRun: ActiveRun;
  client: ConnectedClient;
  broadcastToOtherAuthenticatedClients: (
    clients: Map<string, ConnectedClient>,
    originClientId: string,
    message: import('@zclaudia/shared/wire/messages').ServerMessage,
  ) => void;
  connectedClients: Map<string, ConnectedClient>;
  cwd: string;
  db: ActiveRun['db'];
  message: RunStartMessage;
  notificationService: NotificationSender;
  providerConfig?: LlmProfileConfig;
  llmProfileId: string | null;
  providerType: string;
  runId: string;
  sendMessage: (ws: ConnectedClient['ws'], message: import('@zclaudia/shared/wire/messages').ServerMessage) => void;
  sendRunEvent: (event: import('@zclaudia/shared/wire/messages').ServerMessage) => void;
  session: RunSessionRecord;
  sessionType: 'regular' | 'background' | 'agent';
  markPendingResolutionResumed: () => void;
  permissionBridge?: PermissionBridge;
  permissionWorkflowResolver?: PermissionWorkflowResolver;
}

export interface PreparedProviderRun {
  forcedPlanBySession: boolean;
  modeValue: string;
  permissionCallback: ReturnType<typeof createPermissionCallback>;
  processedInput: string;
}

export function prepareProviderRun(input: PrepareProviderRunInput): PreparedProviderRun {
  const {
    activeRun,
    client,
    broadcastToOtherAuthenticatedClients,
    connectedClients,
    cwd,
    db,
    markPendingResolutionResumed,
    message,
    notificationService,
    providerType,
    runId,
    sendRunEvent,
    session,
    sessionType,
  } = input;

  const processedInput = processAtMentions(message.input, session.root_path);
  console.log('[@ Mention] Original input:', message.input);
  if (processedInput !== message.input) {
    console.log('[@ Mention] Processed input:', processedInput);
  }

  const forcedPlanBySession = session.project_role === 'task' && session.plan_status === 'planning';
  const requestedMode = message.planMode ? 'plan' : 'default';
  const modeValue = forcedPlanBySession ? 'plan' : requestedMode;
  if (forcedPlanBySession && modeValue !== requestedMode) {
    console.log(`[Mode] Forced plan mode for task planning session ${message.sessionId}`);
  }

  const permissionCallback = createPermissionCallback({
    activeRun,
    cwd,
    db,
    forcedPlanBySession,
    markPendingResolutionResumed,
    message: {
      sessionId: message.sessionId,
      permissionOverride: message.permissionOverride,
    },
    modeValue,
    notificationService,
    providerType,
    runId,
    sendRunEvent,
    session: {
      project_id: session.project_id,
    },
    sessionType,
    permissionBridge: input.permissionBridge!,
    permissionWorkflowResolver: input.permissionWorkflowResolver!,
  });

  return {
    forcedPlanBySession,
    modeValue,
    permissionCallback,
    processedInput,
  };
}
