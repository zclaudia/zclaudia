import { processAtMentions } from '../../../utils/server-utils.js';
import { parseMessageInput } from './message-input.js';
import { resolveImageAttachments, type ResolvedImage } from './resolve-image-attachments.js';
import { getFileStore } from '../../../infra/storage/fileStore.js';
import { createPermissionCallback } from './run-permissions.js';
import { resolveUserHooks } from './resolve-user-hooks.js';
import { drainPendingTaskNotices } from './pending-task-notices.js';
import type { RunStartMessage, RunSessionRecord } from './run-bootstrap.js';
import type { ActiveRun, ConnectedClient } from '../transport/types.js';
import type { NotificationSender } from '../../../infra/push/notification-sender.js';
import type { LlmProfileConfig } from '@zclaudia/shared/core/llm-profile';
import type { PermissionBridge } from '../agent/permission-bridge.js';
import type { PermissionWorkflowResolver } from '../../../domains/workflows/index.js';
import type { UserHookDefinition } from '@zclaudia/shared/interaction/user-hooks';
import type { ServerMessage } from '@zclaudia/shared/wire/messages';

interface PrepareProviderRunInput {
  activeRun: ActiveRun;
  client: ConnectedClient;
  broadcastToOtherAuthenticatedClients: (
    clients: Map<string, ConnectedClient>,
    originClientId: string,
    message: ServerMessage
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
  sendMessage: (ws: ConnectedClient['ws'], message: ServerMessage) => void;
  sendRunEvent: (event: ServerMessage) => void;
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
  images: ResolvedImage[];
  userHooks: UserHookDefinition[];
}

export function prepareProviderRun(input: PrepareProviderRunInput): PreparedProviderRun {
  const {
    activeRun,
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

  const parsedInput = parseMessageInput(message.input);
  const { images, notices } = resolveImageAttachments(parsedInput.attachments, getFileStore());
  const mentionProcessed = processAtMentions(parsedInput.text, session.root_path);
  // Background tasks that settled while the session was idle surface here.
  const taskNotices = drainPendingTaskNotices(message.sessionId);
  const allNotices = [...notices, ...taskNotices];
  const processedInput =
    allNotices.length > 0 ? `${mentionProcessed}\n\n${allNotices.join('\n')}` : mentionProcessed;
  console.log('[@ Mention] Original input:', parsedInput.text);
  if (mentionProcessed !== parsedInput.text) {
    console.log('[@ Mention] Processed input:', mentionProcessed);
  }

  // A session in planning status runs read-only — whether opened for planning
  // by supervision (task role) or switched in by the model via enter_plan_mode.
  const forcedPlanBySession = session.plan_status === 'planning';
  const requestedMode = message.mode || 'default';
  const modeValue = forcedPlanBySession ? 'plan' : requestedMode;
  if (forcedPlanBySession && modeValue !== requestedMode) {
    console.log(`[Mode] Forced plan mode for planning session ${message.sessionId}`);
  }

  const { permissionBridge, permissionWorkflowResolver } = input;
  if (!permissionBridge) {
    throw new Error('prepareProviderRun requires a permissionBridge');
  }
  if (!permissionWorkflowResolver) {
    throw new Error('prepareProviderRun requires a permissionWorkflowResolver');
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
    permissionBridge,
    permissionWorkflowResolver,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const userHooks = resolveUserHooks(db as any, session.project_id);

  return {
    forcedPlanBySession,
    modeValue,
    permissionCallback,
    processedInput,
    images,
    userHooks,
  };
}
