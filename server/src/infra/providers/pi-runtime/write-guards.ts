import path from 'path';

// Write `content` is authored by the model in the tool call, so it is bounded by
// output capacity (it can never realistically reach megabytes). This is a sanity
// ceiling for the secret-scan / diff / backup we run on the content, not a real
// limit on the model.
export const MAX_WRITE_CONTENT_BYTES = 2 * 1024 * 1024;
// Edit sends a tiny diff against a possibly-large file. Aligns with
// READ_FAST_PATH_BYTES: "if it can be whole-file read, it can be edited."
export const MAX_EDIT_FILE_BYTES = 10 * 1024 * 1024;

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
  return (
    isAgentSettingsPath(filePath) && UNSAFE_SETTINGS_PATTERNS.some(pattern => pattern.test(content))
  );
}

export function validateMutationContent(
  filePath: string,
  content: string
): GuardFailure | undefined {
  const size = Buffer.byteLength(content, 'utf8');
  if (size > MAX_WRITE_CONTENT_BYTES) {
    return {
      code: 'content_too_large',
      message: `File mutation content is too large (${size} bytes); maximum is ${MAX_WRITE_CONTENT_BYTES} bytes.`,
      details: { size, maxBytes: MAX_WRITE_CONTENT_BYTES },
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
