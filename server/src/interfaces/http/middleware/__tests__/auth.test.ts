import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IncomingMessage } from 'node:http';
import type { Response } from '@zclaudia/shared/wire/correlation';
import {
  authMiddleware,
  optionalAuthMiddleware,
  createHostCapabilityUpgradeGuard,
  rejectUpgrade,
} from '../auth.js';
import { errorResponse } from '../base.js';
import { createHostCapabilityStore, HOST_CAPABILITY_HEADER } from '../../../../auth.js';

// Mock errorResponse
vi.mock('../base.js', () => ({
  errorResponse: vi.fn(),
}));

function createMockErrorResponse(): Response<null> {
  return {
    id: 'mock-id',
    type: 'test.response',
    payload: null,
    timestamp: 0,
    metadata: {
      requestId: 'mock-request-id',
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication required. Please provide a valid API key.',
      },
    },
  };
}

describe('authMiddleware', () => {
  let mockCtx: any;
  let mockNext: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockNext = vi.fn().mockResolvedValue('next-result');
    mockCtx = {
      client: {
        isLocal: false,
        authenticated: false,
      },
      request: { type: 'test-request' },
    };
  });

  describe('local client authentication', () => {
    it('lets local clients through without authentication', async () => {
      mockCtx.client.isLocal = true;
      mockCtx.client.authenticated = false;

      const result = await authMiddleware(mockCtx, mockNext);

      expect(mockNext).toHaveBeenCalledWith(mockCtx);
      expect(result).toBe('next-result');
    });

    it('skips the auth check for local clients', async () => {
      mockCtx.client.isLocal = true;
      mockCtx.client.authenticated = false;

      await authMiddleware(mockCtx, mockNext);

      expect(errorResponse).not.toHaveBeenCalled();
    });
  });

  describe('remote client authentication', () => {
    it('allows authenticated remote clients', async () => {
      mockCtx.client.isLocal = false;
      mockCtx.client.authenticated = true;

      const result = await authMiddleware(mockCtx, mockNext);

      expect(mockNext).toHaveBeenCalledWith(mockCtx);
      expect(result).toBe('next-result');
    });

    it('rejects unauthenticated remote clients', async () => {
      mockCtx.client.isLocal = false;
      mockCtx.client.authenticated = false;

      vi.mocked(errorResponse).mockReturnValue(createMockErrorResponse());

      const result = await authMiddleware(mockCtx, mockNext);

      expect(errorResponse).toHaveBeenCalledWith(
        mockCtx.request,
        'UNAUTHORIZED',
        'Authentication required. Please provide a valid API key.'
      );
      expect(result).toEqual(createMockErrorResponse());
    });

    it('returns the correct error message', async () => {
      mockCtx.client.isLocal = false;
      mockCtx.client.authenticated = false;

      vi.mocked(errorResponse).mockReturnValue(createMockErrorResponse());

      await authMiddleware(mockCtx, mockNext);

      const errorMessage = vi.mocked(errorResponse).mock.calls[0][2];
      expect(errorMessage).toContain('API key');
    });

    it('does not call next for unauthenticated clients', async () => {
      mockCtx.client.isLocal = false;
      mockCtx.client.authenticated = false;

      vi.mocked(errorResponse).mockReturnValue(createMockErrorResponse());

      await authMiddleware(mockCtx, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('edge cases', () => {
    it('handles a missing client object', async () => {
      mockCtx.client = undefined as any;
      vi.mocked(errorResponse).mockReturnValue(createMockErrorResponse());

      const result = await authMiddleware(mockCtx, mockNext);

      expect(errorResponse).toHaveBeenCalledWith(
        mockCtx.request,
        'UNAUTHORIZED',
        'Authentication required. Please provide a valid API key.'
      );
      expect(mockNext).not.toHaveBeenCalled();
      expect(result).toEqual(createMockErrorResponse());
    });

    it('handles an undefined authenticated flag', async () => {
      mockCtx.client.isLocal = false;
      mockCtx.client.authenticated = undefined as any;

      vi.mocked(errorResponse).mockReturnValue(createMockErrorResponse());

      const result = await authMiddleware(mockCtx, mockNext);

      // undefined is treated as falsy, so the request is rejected
      expect(errorResponse).toHaveBeenCalled();
      expect(result).toEqual(createMockErrorResponse());
    });

    it('handles a null authenticated flag', async () => {
      mockCtx.client.isLocal = false;
      mockCtx.client.authenticated = null as any;

      vi.mocked(errorResponse).mockReturnValue(createMockErrorResponse());

      const result = await authMiddleware(mockCtx, mockNext);

      // null is treated as falsy, so the request is rejected
      expect(errorResponse).toHaveBeenCalled();
      expect(result).toEqual(createMockErrorResponse());
    });
  });
});

describe('optionalAuthMiddleware', () => {
  let mockCtx: any;
  let mockNext: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockNext = vi.fn().mockResolvedValue('next-result');
    mockCtx = {
      client: {
        isLocal: false,
        authenticated: false,
      },
      request: { type: 'test-request' },
    };
  });

  it('always lets the request continue', async () => {
    mockCtx.client.isLocal = false;
    mockCtx.client.authenticated = false;

    const result = await optionalAuthMiddleware(mockCtx, mockNext);

    expect(mockNext).toHaveBeenCalledWith(mockCtx);
    expect(result).toBe('next-result');
  });

  it('calls next regardless of auth status', async () => {
    // unauthenticated
    mockCtx.client.authenticated = false;
    await optionalAuthMiddleware(mockCtx, mockNext);
    expect(mockNext).toHaveBeenCalled();

    // reset
    mockNext.mockClear();

    // authenticated
    mockCtx.client.authenticated = true;
    await optionalAuthMiddleware(mockCtx, mockNext);
    expect(mockNext).toHaveBeenCalled();
  });

  it('lets local clients continue', async () => {
    mockCtx.client.isLocal = true;
    mockCtx.client.authenticated = false;

    const result = await optionalAuthMiddleware(mockCtx, mockNext);

    expect(mockNext).toHaveBeenCalledWith(mockCtx);
    expect(result).toBe('next-result');
  });

  it('lets authenticated remote clients continue', async () => {
    mockCtx.client.isLocal = false;
    mockCtx.client.authenticated = true;

    const result = await optionalAuthMiddleware(mockCtx, mockNext);

    expect(mockNext).toHaveBeenCalledWith(mockCtx);
    expect(result).toBe('next-result');
  });

  it('does not call errorResponse', async () => {
    await optionalAuthMiddleware(mockCtx, mockNext);

    expect(errorResponse).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// createHostCapabilityUpgradeGuard (one-time ticket on the /ws/host upgrade)
// ---------------------------------------------------------------------------

function createMockUpgradeRequest(
  headers: Record<string, string | string[]> = {}
): IncomingMessage {
  return { headers } as unknown as IncomingMessage;
}

describe('createHostCapabilityUpgradeGuard', () => {
  it('lets an upgrade through when the one-time ticket is valid', () => {
    const store = createHostCapabilityStore();
    const { capability } = store.issue();
    const guard = createHostCapabilityUpgradeGuard(
      (cap: string | undefined) => store.consume(cap),
      HOST_CAPABILITY_HEADER
    );

    const req = createMockUpgradeRequest({ [HOST_CAPABILITY_HEADER]: capability });

    expect(guard(req)).toBe(true);
  });

  it('consumes the ticket, so a replayed upgrade is rejected', () => {
    const store = createHostCapabilityStore();
    const guard = createHostCapabilityUpgradeGuard(
      (cap: string | undefined) => store.consume(cap),
      HOST_CAPABILITY_HEADER
    );
    const { capability } = store.issue();
    const firstAttempt = createMockUpgradeRequest({ [HOST_CAPABILITY_HEADER]: capability });

    expect(guard(firstAttempt)).toBe(true);
    // Same ticket again (replay) — rejected even though it is still within TTL.
    expect(guard(firstAttempt)).toBe(false);
  });

  it('rejects an upgrade without the capability header', () => {
    const store = createHostCapabilityStore();
    const guard = createHostCapabilityUpgradeGuard(
      (cap: string | undefined) => store.consume(cap),
      HOST_CAPABILITY_HEADER
    );

    expect(guard(createMockUpgradeRequest())).toBe(false);
    expect(guard(createMockUpgradeRequest({ 'x-other-header': 'value' }))).toBe(false);
  });

  it('rejects an upgrade presenting an unknown or empty ticket', () => {
    const store = createHostCapabilityStore();
    const guard = createHostCapabilityUpgradeGuard(
      (cap: string | undefined) => store.consume(cap),
      HOST_CAPABILITY_HEADER
    );

    expect(guard(createMockUpgradeRequest({ [HOST_CAPABILITY_HEADER]: 'never-issued' }))).toBe(
      false
    );
    expect(guard(createMockUpgradeRequest({ [HOST_CAPABILITY_HEADER]: '' }))).toBe(false);
  });

  it('matches real node headers (lower-cased keys) even for a mixed-case header name', () => {
    const store = createHostCapabilityStore();
    // Real Node IncomingMessage lower-cases incoming header names; the guard
    // must normalize the configured header name the same way.
    const guard = createHostCapabilityUpgradeGuard(
      (cap: string | undefined) => store.consume(cap),
      'X-Zclaudia-Host-Capability'
    );
    const { capability } = store.issue();

    const req = createMockUpgradeRequest({ 'x-zclaudia-host-capability': capability });
    expect(guard(req)).toBe(true);
  });

  it('handles array-valued headers by consuming the first value', () => {
    const consume = vi.fn(() => true);
    const guard = createHostCapabilityUpgradeGuard(consume, HOST_CAPABILITY_HEADER);

    guard(createMockUpgradeRequest({ [HOST_CAPABILITY_HEADER]: ['ticket-a', 'ticket-b'] }));

    expect(consume).toHaveBeenCalledWith('ticket-a');
  });
});

describe('rejectUpgrade', () => {
  it('writes a 401 JSON response and closes the socket', () => {
    const writes: string[] = [];
    const socket = {
      end: (chunk: string) => {
        writes.push(chunk);
      },
    } as never;

    rejectUpgrade(socket, 401, 'Invalid or expired host capability');

    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain('HTTP/1.1 401 Unauthorized');
    expect(writes[0]).toContain('Invalid or expired host capability');
    // Blank line separates the headers from the JSON body.
    expect(writes[0]).toContain('\r\n\r\n{"success":false');
  });
});
