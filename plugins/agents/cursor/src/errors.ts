/**
 * Stable error codes for the Cursor ACP transport (design doc §13).
 *
 * The UI matches on `errorCode`, never on message text. Messages are safe to
 * surface: they carry no prompt content, tokens, or bridge URLs — paths are
 * shortened and stderr tails are redacted by `sanitizeErrorDetail`.
 */
export const CURSOR_ACP_ERROR_CODES = [
  'CURSOR_ACP_UNSUPPORTED',
  'CURSOR_AUTH_REQUIRED',
  'CURSOR_ACP_HANDSHAKE_FAILED',
  'CURSOR_ACP_MODE_UNSUPPORTED',
  'CURSOR_SESSION_NOT_FOUND',
  'CURSOR_MODEL_UNSUPPORTED',
  'CURSOR_MCP_BRIDGE_UNAVAILABLE',
  'CURSOR_PERMISSION_PROTOCOL_ERROR',
  'CURSOR_ACP_PROTOCOL_ERROR',
  'CURSOR_PROCESS_EXIT',
] as const;

export type CursorAcpErrorCode = (typeof CURSOR_ACP_ERROR_CODES)[number];

const MAX_STDERR_DETAIL = 2_000;

/** Secret-bearing fragments that must never reach an error message or log. */
const REDACTION_PATTERNS: Array<[RegExp, string]> = [
  [/\b(sk-[A-Za-z0-9_-]{8,})/g, 'sk-<redacted>'],
  [/\bBearer\s+[A-Za-z0-9._-]+/gi, 'Bearer <redacted>'],
  [/([?&](?:token|key|secret|authorization)=)[^&\s'"]+/gi, '$1<redacted>'],
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '<email>'],
];

export function sanitizeErrorDetail(detail: string): string {
  let sanitized = detail.slice(0, MAX_STDERR_DETAIL);
  for (const [pattern, replacement] of REDACTION_PATTERNS) {
    sanitized = sanitized.replaceAll(pattern, replacement);
  }
  return sanitized;
}

const LOGIN_HELP =
  'Run `cursor-agent login` in a terminal to sign in, then retry. See https://cursor.com/cli for details.';

/**
 * Structured error for the ACP transport. `code` is one of the stable codes
 * above; `message` is user-presentable and already sanitized.
 */
export class CursorAcpError extends Error {
  readonly code: CursorAcpErrorCode;

  constructor(code: CursorAcpErrorCode, message: string) {
    super(sanitizeErrorDetail(message));
    this.name = 'CursorAcpError';
    this.code = code;
  }
}

/**
 * Classify a JSON-RPC error from the agent into a stable error code.
 * `CURSOR_SESSION_NOT_FOUND` matches the probed wire shape: -32602 with
 * `data.message` containing "not found" (design doc §13).
 */
export function errorCodeFromJsonRpcError(
  method: string,
  error: { code?: number; message?: string; data?: unknown }
): CursorAcpErrorCode {
  const dataMessage = readDataMessage(error.data);
  if (error.code === -32602 && /not found/i.test(`${error.message ?? ''} ${dataMessage}`)) {
    return 'CURSOR_SESSION_NOT_FOUND';
  }
  if (/auth/i.test(`${method} ${error.message ?? ''} ${dataMessage}`)) {
    return 'CURSOR_AUTH_REQUIRED';
  }
  return 'CURSOR_ACP_PROTOCOL_ERROR';
}

function readDataMessage(data: unknown): string {
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const message = (data as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  if (typeof data === 'string') return data;
  return '';
}

export { LOGIN_HELP };
