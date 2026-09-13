import type { InvocableDescriptor, InvocationRequest } from '@zclaudia/shared/providers';
import type { MessageAttachment, UnifiedPermissionPolicy } from '@zclaudia/shared';

/**
 * Canonical invocation submission (URIP design doc §16.3).
 *
 * Two submission paths:
 * 1. Catalog selection — submit the canonical ID, revision, context
 *    fingerprint, and exactly one argument representation as a run_start V2
 *    `invocation` turn input.
 * 2. Raw submission — the original text; reserved namespaces are resolved
 *    server-side unless the user explicitly chose "send literally"
 *    (`reservedNamespaceMode: 'literal'`).
 *
 * The desktop never infers execution behavior from `kind`, `origin`, a file
 * name, or the displayed trigger.
 */

export interface SelectedInvocable {
  descriptor: InvocableDescriptor;
  /** The trigger text as displayed; kept editable in the composer. */
  typedTrigger: string;
  arguments: { type: 'raw'; value: string };
}

export type SubmissionMessage =
  | {
      type: 'run_start';
      protocolVersion: 2;
      clientRequestId: string;
      sessionId: string;
      turnInput: {
        type: 'message';
        text: string;
        attachments?: MessageAttachment[];
        reservedNamespaceMode?: 'resolve' | 'literal';
      };
      mode?: string;
      permissionOverride?: Partial<UnifiedPermissionPolicy>;
      workingDirectory?: string;
    }
  | {
      type: 'run_start';
      protocolVersion: 2;
      clientRequestId: string;
      sessionId: string;
      turnInput: {
        type: 'invocation';
        request: InvocationRequest;
        attachments?: MessageAttachment[];
      };
      permissionOverride?: Partial<UnifiedPermissionPolicy>;
    };

export function newClientRequestId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function buildCanonicalInvocationSubmission(
  sessionId: string,
  selected: SelectedInvocable,
  snapshot: NonNullable<
    | {
        revision: string;
        contextFingerprint: string;
      }
    | undefined
  >,
  options: {
    attachments?: MessageAttachment[];
    permissionOverride?: Partial<UnifiedPermissionPolicy>;
  } = {}
): SubmissionMessage {
  return {
    type: 'run_start',
    protocolVersion: 2,
    clientRequestId: newClientRequestId(),
    sessionId,
    turnInput: {
      type: 'invocation',
      request: {
        invocableId: selected.descriptor.id,
        catalogRevision: snapshot.revision,
        contextFingerprint: snapshot.contextFingerprint,
        arguments: selected.arguments,
      },
      ...(options.attachments?.length ? { attachments: options.attachments } : {}),
    },
    ...(options.permissionOverride ? { permissionOverride: options.permissionOverride } : {}),
  };
}

export function buildRawMessageSubmission(
  sessionId: string,
  text: string,
  options: {
    sendLiterally?: boolean;
    attachments?: MessageAttachment[];
    mode?: string;
    permissionOverride?: Partial<UnifiedPermissionPolicy>;
    workingDirectory?: string;
  } = {}
): SubmissionMessage {
  return {
    type: 'run_start',
    protocolVersion: 2,
    clientRequestId: newClientRequestId(),
    sessionId,
    turnInput: {
      type: 'message',
      text,
      ...(options.attachments?.length ? { attachments: options.attachments } : {}),
      ...(options.sendLiterally ? { reservedNamespaceMode: 'literal' as const } : {}),
    },
    ...(options.mode ? { mode: options.mode } : {}),
    ...(options.permissionOverride ? { permissionOverride: options.permissionOverride } : {}),
    ...(options.workingDirectory ? { workingDirectory: options.workingDirectory } : {}),
  };
}

/**
 * Determine whether the composer has a live canonical selection: the typed
 * trigger must still match the selected descriptor exactly — editing the text
 * so it no longer matches clears the hidden selection (§16.2).
 */
export function activeSelection(
  selection: SelectedInvocable | undefined,
  currentText: string
): SelectedInvocable | undefined {
  if (!selection) return undefined;
  const typed = selection.typedTrigger;
  if (currentText === typed || currentText.startsWith(`${typed} `)) return selection;
  return undefined;
}
