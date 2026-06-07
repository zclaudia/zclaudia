import { describe, it, expect } from 'vitest';
import { CodexOAuthError, codexOAuthErrorToHttpStatus } from '../codex-oauth-errors.js';

describe('CodexOAuthError', () => {
  it('exposes code and message', () => {
    const err = new CodexOAuthError('NOT_AUTHENTICATED', 'pls login');
    expect(err.code).toBe('NOT_AUTHENTICATED');
    expect(err.message).toBe('pls login');
    expect(err).toBeInstanceOf(Error);
  });

  it('maps codes to HTTP statuses', () => {
    expect(codexOAuthErrorToHttpStatus('NOT_AUTHENTICATED')).toBe(401);
    expect(codexOAuthErrorToHttpStatus('REFRESH_FAILED_TERMINAL')).toBe(401);
    expect(codexOAuthErrorToHttpStatus('REFRESH_FAILED_TRANSIENT')).toBe(503);
    expect(codexOAuthErrorToHttpStatus('OAUTH_CANCELLED')).toBe(499);
    expect(codexOAuthErrorToHttpStatus('OAUTH_TIMEOUT')).toBe(408);
    expect(codexOAuthErrorToHttpStatus('OAUTH_PORT_CONFLICT')).toBe(409);
    expect(codexOAuthErrorToHttpStatus('OAUTH_STATE_MISMATCH')).toBe(400);
    expect(codexOAuthErrorToHttpStatus('MODELS_FETCH_FAILED')).toBe(503);
    expect(codexOAuthErrorToHttpStatus('RESPONSE_ENDPOINT_REJECTED')).toBe(403);
  });
});
