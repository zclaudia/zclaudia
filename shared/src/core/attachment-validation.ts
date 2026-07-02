export const MAX_MESSAGE_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_MESSAGE_ATTACHMENTS = 8;

const SUPPORTED_ATTACHMENT_EXTENSIONS = new Set(['.pdf', '.txt', '.md', '.json', '.csv']);
const SUPPORTED_ATTACHMENT_MIME_TYPES = new Set([
  'application/pdf',
  'application/json',
  'text/csv',
  'application/csv',
]);

export interface MessageAttachmentCandidate {
  name: string;
  size: number;
  type?: string;
}

export type MessageAttachmentValidationCode = 'too_many' | 'file_too_large' | 'unsupported_type';

export interface MessageAttachmentValidationIssue {
  code: MessageAttachmentValidationCode;
  fileName: string;
  message: string;
}

export interface MessageAttachmentValidationOptions {
  existingCount?: number;
}

export interface MessageAttachmentValidationResult<T extends MessageAttachmentCandidate> {
  accepted: T[];
  rejected: MessageAttachmentValidationIssue[];
}

function formatAttachmentLimit(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return Number.isInteger(mb) ? `${mb} MB` : `${mb.toFixed(1)} MB`;
}

function getExtension(name: string): string {
  const dotIndex = name.lastIndexOf('.');
  return dotIndex >= 0 ? name.slice(dotIndex).toLowerCase() : '';
}

export function isSupportedMessageAttachment(file: MessageAttachmentCandidate): boolean {
  const mimeType = (file.type ?? '').toLowerCase();
  if (mimeType.startsWith('image/') || mimeType.startsWith('text/')) return true;
  if (SUPPORTED_ATTACHMENT_MIME_TYPES.has(mimeType)) return true;
  return SUPPORTED_ATTACHMENT_EXTENSIONS.has(getExtension(file.name));
}

export function validateMessageAttachmentFiles<T extends MessageAttachmentCandidate>(
  files: readonly T[],
  options: MessageAttachmentValidationOptions = {}
): MessageAttachmentValidationResult<T> {
  const existingCount = Math.max(0, options.existingCount ?? 0);
  const remainingSlots = Math.max(0, MAX_MESSAGE_ATTACHMENTS - existingCount);
  const accepted: T[] = [];
  const rejected: MessageAttachmentValidationIssue[] = [];

  for (const file of files) {
    if (accepted.length >= remainingSlots) {
      rejected.push({
        code: 'too_many',
        fileName: file.name,
        message: `You can attach up to ${MAX_MESSAGE_ATTACHMENTS} files.`,
      });
      continue;
    }

    if (file.size > MAX_MESSAGE_ATTACHMENT_BYTES) {
      rejected.push({
        code: 'file_too_large',
        fileName: file.name,
        message: `"${file.name}" is too large. Attachments must be ${formatAttachmentLimit(
          MAX_MESSAGE_ATTACHMENT_BYTES
        )} or smaller.`,
      });
      continue;
    }

    if (!isSupportedMessageAttachment(file)) {
      rejected.push({
        code: 'unsupported_type',
        fileName: file.name,
        message: `"${file.name}" is not a supported attachment type.`,
      });
      continue;
    }

    accepted.push(file);
  }

  return { accepted, rejected };
}
