import type { ServerMessage } from '@zclaudia/shared';
import { handleLocalPRMessage } from './local-pr/handlers';
import { handleLocalIssueMessage } from './local-issues/handlers';
import { handleWorkflowMessage } from './workflows/handlers';
import { handleSupervisionMessage } from './supervision/handlers';
import { handleAttachmentMessage } from './attachments/handlers';
import { handleMetaWorkflowMessage } from './meta-workflow/handlers.js';
import { handleOpenSpecMessage } from './openspec/handlers';
import { handleBrowserMessage } from './browser/handlers';

export type FeatureMessageHandler = (msg: ServerMessage) => boolean;

const featureMessageHandlers: FeatureMessageHandler[] = [
  handleLocalPRMessage,
  handleLocalIssueMessage,
  handleWorkflowMessage,
  handleSupervisionMessage,
  handleAttachmentMessage,
  handleMetaWorkflowMessage,
  handleOpenSpecMessage,
  handleBrowserMessage,
];

export function dispatchFeatureMessage(msg: ServerMessage): boolean {
  for (const handler of featureMessageHandlers) {
    if (handler(msg)) return true;
  }
  return false;
}
