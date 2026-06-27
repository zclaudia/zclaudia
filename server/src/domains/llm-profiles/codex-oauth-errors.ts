export type CodexOAuthErrorCode =
  | 'NOT_AUTHENTICATED'
  | 'REFRESH_FAILED_TERMINAL'
  | 'REFRESH_FAILED_TRANSIENT'
  | 'OAUTH_CANCELLED'
  | 'OAUTH_TIMEOUT'
  | 'OAUTH_PORT_CONFLICT'
  | 'OAUTH_STATE_MISMATCH'
  | 'OAUTH_DEVICE_AUTH_CHALLENGE'
  | 'MODELS_FETCH_FAILED'
  | 'RESPONSE_ENDPOINT_REJECTED';

export class CodexOAuthError extends Error {
  constructor(public readonly code: CodexOAuthErrorCode, message: string) {
    super(message);
    this.name = 'CodexOAuthError';
  }
}

export function codexOAuthErrorToHttpStatus(code: CodexOAuthErrorCode): number {
  switch (code) {
    case 'NOT_AUTHENTICATED':
    case 'REFRESH_FAILED_TERMINAL':
      return 401;
    case 'RESPONSE_ENDPOINT_REJECTED':
      return 403;
    case 'OAUTH_STATE_MISMATCH':
      return 400;
    case 'OAUTH_DEVICE_AUTH_CHALLENGE':
      return 429;
    case 'OAUTH_TIMEOUT':
      return 408;
    case 'OAUTH_CANCELLED':
      return 499;
    case 'OAUTH_PORT_CONFLICT':
      return 409;
    case 'MODELS_FETCH_FAILED':
    case 'REFRESH_FAILED_TRANSIENT':
      return 503;
  }
}
