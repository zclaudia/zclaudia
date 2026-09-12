import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Response } from '@zclaudia/shared/wire/correlation';
import { authMiddleware, optionalAuthMiddleware } from '../auth.js';
import { errorResponse } from '../base.js';

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
