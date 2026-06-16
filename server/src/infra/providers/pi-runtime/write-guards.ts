import path from 'path';

export const MAX_TEXT_MUTATION_FILE_BYTES = 512 * 1024;
export const MAX_EDIT_FILE_BYTES = MAX_TEXT_MUTATION_FILE_BYTES;

const SECRET_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bsk-ant-[A-Za-z0-9_-]{20,}\b/,
  /\bghp_[A-Za-z0-9_]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  /\bAWS_SECRET_ACCESS_KEY\s*=\s*[A-Za-z0-9/+=]{20,}\b/,
];

const UNSAFE_SETTINGS_PATTERNS = [
  /"permissionMode"\s*:\s*"bypassPermissions"/,
  /"dangerouslySkipPermissions"\s*:\s*true/,
  /"autoApprove"\s*:\s*true/,
];

export interface GuardFailure {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export function containsObviousSecret(content: string): boolean {
  return SECRET_PATTERNS.some(pattern => pattern.test(content));
}

export function isAgentSettingsPath(filePath: string): boolean {
  const normalized = filePath.split(path.sep).join('/');
  return /(^|\/)\.(claude|cursor)\/(settings|mcp)\.json$/i.test(normalized);
}

export function hasUnsafeSettingsChange(filePath: string, content: string): boolean {
  return isAgentSettingsPath(filePath) && UNSAFE_SETTINGS_PATTERNS.some(pattern => pattern.test(content));
}

export function validateMutationContent(filePath: string, content: string): GuardFailure | undefined {
  const size = Buffer.byteLength(content, 'utf8');
  if (size > MAX_TEXT_MUTATION_FILE_BYTES) {
    return {
      code: 'content_too_large',
      message: `File mutation content is too large (${size} bytes); maximum is ${MAX_TEXT_MUTATION_FILE_BYTES} bytes.`,
      details: { size, maxBytes: MAX_TEXT_MUTATION_FILE_BYTES },
    };
  }
  if (containsObviousSecret(content)) {
    return {
      code: 'secret_detected',
      message: 'File mutation appears to contain secret material.',
    };
  }
  if (hasUnsafeSettingsChange(filePath, content)) {
    return {
      code: 'unsafe_settings_change',
      message: 'Agent settings change would relax permission safeguards.',
    };
  }
  return undefined;
}
