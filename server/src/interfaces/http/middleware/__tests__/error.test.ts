import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Response } from '@zclaudia/shared/wire/correlation';
import {
  AppError,
  errorHandlingMiddleware,
  validationErrorMiddleware,
  dbErrorMiddleware,
} from '../error.js';
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
        code: 'INTERNAL_ERROR',
        message: 'Mocked error response',
      },
    },
  };
}

describe('AppError', () => {
  it('creates an error with code and message', () => {
    const error = new AppError('TEST_CODE', 'Test message');

    expect(error.code).toBe('TEST_CODE');
    expect(error.message).toBe('Test message');
    expect(error.name).toBe('AppError');
    expect(error).toBeInstanceOf(Error);
  });

  it('includes optional details', () => {
    const error = new AppError('TEST_CODE', 'Test', { field: 'value', count: 42 });

    expect(error.details).toEqual({ field: 'value', count: 42 });
  });

  it('allows details to be undefined', () => {
    const error = new AppError('TEST_CODE', 'Test');

    expect(error.details).toBeUndefined();
  });

  it('allows details of various types', () => {
    const error1 = new AppError('CODE', 'Test', 'string details');
    const error2 = new AppError('CODE', 'Test', [1, 2, 3]);
    const error3 = new AppError('CODE', 'Test', new Error('inner'));

    expect(error1.details).toBe('string details');
    expect(error2.details).toEqual([1, 2, 3]);
    expect(error3.details).toBeInstanceOf(Error);
  });
});

describe('errorHandlingMiddleware', () => {
  let mockCtx: any;
  let mockNext: any;
  let consoleErrorSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockCtx = {
      request: { type: 'test-request' },
    };

    mockNext = vi.fn();

    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  describe('AppError handling', () => {
    it('catches AppError and returns a formatted error response', async () => {
      const appError = new AppError('NOT_FOUND', 'Resource not found', { id: 123 });
      mockNext.mockRejectedValue(appError);
      vi.mocked(errorResponse).mockReturnValue(createMockErrorResponse());

      const result = await errorHandlingMiddleware(mockCtx, mockNext);

      expect(errorResponse).toHaveBeenCalledWith(
        mockCtx.request,
        'NOT_FOUND',
        'Resource not found',
        { id: 123 }
      );
      expect(result).toEqual(createMockErrorResponse());
    });

    it('logs the error to the console', async () => {
      const appError = new AppError('TEST_CODE', 'Test error');
      mockNext.mockRejectedValue(appError);

      await errorHandlingMiddleware(mockCtx, mockNext);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[ErrorMiddleware] Error processing test-request:',
        appError
      );
    });

    it('handles an AppError without details', async () => {
      const appError = new AppError('TEST_CODE', 'Test error');
      mockNext.mockRejectedValue(appError);
      vi.mocked(errorResponse).mockReturnValue(createMockErrorResponse());

      await errorHandlingMiddleware(mockCtx, mockNext);

      expect(errorResponse).toHaveBeenCalledWith(
        mockCtx.request,
        'TEST_CODE',
        'Test error',
        undefined
      );
    });
  });

  describe('generic Error handling', () => {
    it('handles a standard Error object', async () => {
      const error = new Error('Something went wrong');
      mockNext.mockRejectedValue(error);
      vi.mocked(errorResponse).mockReturnValue(createMockErrorResponse());

      const result = await errorHandlingMiddleware(mockCtx, mockNext);

      expect(errorResponse).toHaveBeenCalledWith(
        mockCtx.request,
        'INTERNAL_ERROR',
        'Something went wrong'
      );
      expect(result).toEqual(createMockErrorResponse());
    });

    it('extracts the error code from error.code', async () => {
      const error: any = new Error('Custom error');
      error.code = 'CUSTOM_CODE';
      mockNext.mockRejectedValue(error);
      vi.mocked(errorResponse).mockReturnValue(createMockErrorResponse());

      const result = await errorHandlingMiddleware(mockCtx, mockNext);

      expect(errorResponse).toHaveBeenCalledWith(mockCtx.request, 'CUSTOM_CODE', 'Custom error');
      expect(result).toEqual(createMockErrorResponse());
    });

    it('defaults generic errors to INTERNAL_ERROR', async () => {
      const error = new Error('Generic error');
      mockNext.mockRejectedValue(error);
      vi.mocked(errorResponse).mockReturnValue(createMockErrorResponse());

      await errorHandlingMiddleware(mockCtx, mockNext);

      expect(errorResponse).toHaveBeenCalledWith(
        expect.anything(),
        'INTERNAL_ERROR',
        expect.anything()
      );
    });

    it('logs generic errors', async () => {
      const error = new Error('Test error');
      mockNext.mockRejectedValue(error);

      await errorHandlingMiddleware(mockCtx, mockNext);

      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });

  describe('unknown error types', () => {
    it('handles string errors', async () => {
      mockNext.mockRejectedValue('Something failed');
      vi.mocked(errorResponse).mockReturnValue(createMockErrorResponse());

      const result = await errorHandlingMiddleware(mockCtx, mockNext);

      expect(errorResponse).toHaveBeenCalledWith(
        mockCtx.request,
        'INTERNAL_ERROR',
        'An unexpected error occurred',
        { error: 'Something failed' }
      );
      expect(result).toEqual(createMockErrorResponse());
    });

    it('handles object errors', async () => {
      const errorObj = { reason: 'unknown', code: 500 };
      mockNext.mockRejectedValue(errorObj);
      vi.mocked(errorResponse).mockReturnValue(createMockErrorResponse());

      const result = await errorHandlingMiddleware(mockCtx, mockNext);

      expect(errorResponse).toHaveBeenCalledWith(
        mockCtx.request,
        'INTERNAL_ERROR',
        'An unexpected error occurred',
        { error: String(errorObj) }
      );
      expect(result).toEqual(createMockErrorResponse());
    });

    it('handles null errors', async () => {
      mockNext.mockRejectedValue(null);
      vi.mocked(errorResponse).mockReturnValue(createMockErrorResponse());

      const result = await errorHandlingMiddleware(mockCtx, mockNext);

      expect(errorResponse).toHaveBeenCalledWith(
        mockCtx.request,
        'INTERNAL_ERROR',
        'An unexpected error occurred',
        { error: 'null' }
      );
      expect(result).toEqual(createMockErrorResponse());
    });

    it('handles undefined errors', async () => {
      mockNext.mockRejectedValue(undefined);
      vi.mocked(errorResponse).mockReturnValue(createMockErrorResponse());

      const result = await errorHandlingMiddleware(mockCtx, mockNext);

      expect(errorResponse).toHaveBeenCalledWith(
        mockCtx.request,
        'INTERNAL_ERROR',
        'An unexpected error occurred',
        { error: 'undefined' }
      );
      expect(result).toEqual(createMockErrorResponse());
    });

    it('handles number errors', async () => {
      mockNext.mockRejectedValue(42);
      vi.mocked(errorResponse).mockReturnValue(createMockErrorResponse());

      const result = await errorHandlingMiddleware(mockCtx, mockNext);

      expect(errorResponse).toHaveBeenCalledWith(
        mockCtx.request,
        'INTERNAL_ERROR',
        'An unexpected error occurred',
        { error: '42' }
      );
      expect(result).toEqual(createMockErrorResponse());
    });
  });

  describe('success path', () => {
    it('passes through when no error is thrown', async () => {
      mockNext.mockResolvedValue('success-result');

      const result = await errorHandlingMiddleware(mockCtx, mockNext);

      expect(result).toBe('success-result');
      expect(errorResponse).not.toHaveBeenCalled();
    });

    it('returns the result of next()', async () => {
      const expectedResult = { data: 'test' };
      mockNext.mockResolvedValue(expectedResult);

      const result = await errorHandlingMiddleware(mockCtx, mockNext);

      expect(result).toBe(expectedResult);
    });

    it('does not log on the success path', async () => {
      mockNext.mockResolvedValue('success');

      await errorHandlingMiddleware(mockCtx, mockNext);

      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });
  });
});

describe('validationErrorMiddleware', () => {
  let mockCtx: any;
  let mockNext: any;
  let consoleLogSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockCtx = {
      request: { type: 'test-request' },
    };

    mockNext = vi.fn();

    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  it('catches a VALIDATION_ERROR AppError', async () => {
    const validationError = new AppError('VALIDATION_ERROR', 'Name is required', {
      field: 'name',
    });
    mockNext.mockRejectedValue(validationError);
    vi.mocked(errorResponse).mockReturnValue(createMockErrorResponse());

    const result = await validationErrorMiddleware(mockCtx, mockNext);

    expect(errorResponse).toHaveBeenCalledWith(
      mockCtx.request,
      'VALIDATION_ERROR',
      'Name is required',
      { field: 'name' }
    );
    expect(result).toEqual(createMockErrorResponse());
  });

  it('logs validation errors to the console', async () => {
    const validationError = new AppError('VALIDATION_ERROR', 'Invalid input', {
      field: 'email',
    });
    mockNext.mockRejectedValue(validationError);

    await validationErrorMiddleware(mockCtx, mockNext);

    expect(consoleLogSpy).toHaveBeenCalledWith('[ValidationError] Invalid input', {
      field: 'email',
    });
  });

  it('rethrows non-validation errors', async () => {
    const otherError = new AppError('OTHER_CODE', 'Other error');
    mockNext.mockRejectedValue(otherError);

    await expect(validationErrorMiddleware(mockCtx, mockNext)).rejects.toThrow(otherError);
  });

  it('rethrows generic Errors', async () => {
    const genericError = new Error('Generic error');
    mockNext.mockRejectedValue(genericError);

    await expect(validationErrorMiddleware(mockCtx, mockNext)).rejects.toThrow(genericError);
  });

  it('lets successful requests pass through', async () => {
    mockNext.mockResolvedValue('success');

    const result = await validationErrorMiddleware(mockCtx, mockNext);

    expect(result).toBe('success');
    expect(errorResponse).not.toHaveBeenCalled();
  });
});

describe('dbErrorMiddleware', () => {
  let mockCtx: any;
  let mockNext: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockCtx = {
      request: { type: 'test-request' },
    };

    mockNext = vi.fn();
  });

  describe('UNIQUE constraint', () => {
    it('handles UNIQUE constraint violations', async () => {
      const dbError = new Error('UNIQUE constraint failed: users.email');
      mockNext.mockRejectedValue(dbError);
      vi.mocked(errorResponse).mockReturnValue(createMockErrorResponse());

      const result = await dbErrorMiddleware(mockCtx, mockNext);

      expect(errorResponse).toHaveBeenCalledWith(
        mockCtx.request,
        'DUPLICATE_ERROR',
        'A record with this information already exists',
        { originalError: 'UNIQUE constraint failed: users.email' }
      );
      expect(result).toEqual(createMockErrorResponse());
    });

    it('detects UNIQUE constraint (case-insensitive)', async () => {
      const dbError = new Error('unique constraint violation');
      mockNext.mockRejectedValue(dbError);
      vi.mocked(errorResponse).mockReturnValue(createMockErrorResponse());

      await dbErrorMiddleware(mockCtx, mockNext);

      expect(errorResponse).toHaveBeenCalledWith(
        expect.anything(),
        'DUPLICATE_ERROR',
        expect.anything(),
        expect.objectContaining({ originalError: 'unique constraint violation' })
      );
    });
  });

  describe('FOREIGN KEY constraint', () => {
    it('handles FOREIGN KEY constraint violations', async () => {
      const dbError = new Error('FOREIGN KEY constraint failed');
      mockNext.mockRejectedValue(dbError);
      vi.mocked(errorResponse).mockReturnValue(createMockErrorResponse());

      const result = await dbErrorMiddleware(mockCtx, mockNext);

      expect(errorResponse).toHaveBeenCalledWith(
        mockCtx.request,
        'REFERENCE_ERROR',
        'Cannot perform this operation due to existing references',
        { originalError: 'FOREIGN KEY constraint failed' }
      );
      expect(result).toEqual(createMockErrorResponse());
    });

    it('detects FOREIGN KEY constraint (case-insensitive)', async () => {
      const dbError = new Error('foreign key constraint violation');
      mockNext.mockRejectedValue(dbError);
      vi.mocked(errorResponse).mockReturnValue(createMockErrorResponse());

      await dbErrorMiddleware(mockCtx, mockNext);

      expect(errorResponse).toHaveBeenCalledWith(
        expect.anything(),
        'REFERENCE_ERROR',
        expect.anything(),
        expect.objectContaining({ originalError: 'foreign key constraint violation' })
      );
    });
  });

  describe('database access errors', () => {
    it('handles database locked errors', async () => {
      const dbError = new Error('database is locked');
      mockNext.mockRejectedValue(dbError);
      vi.mocked(errorResponse).mockReturnValue(createMockErrorResponse());

      const result = await dbErrorMiddleware(mockCtx, mockNext);

      expect(errorResponse).toHaveBeenCalledWith(
        mockCtx.request,
        'DATABASE_ERROR',
        'Database error occurred',
        { originalError: 'database is locked' }
      );
      expect(result).toEqual(createMockErrorResponse());
    });

    it('handles missing table errors', async () => {
      const dbError = new Error('no such table: users');
      mockNext.mockRejectedValue(dbError);
      vi.mocked(errorResponse).mockReturnValue(createMockErrorResponse());

      const result = await dbErrorMiddleware(mockCtx, mockNext);

      expect(errorResponse).toHaveBeenCalledWith(
        mockCtx.request,
        'DATABASE_ERROR',
        'Database error occurred',
        { originalError: 'no such table: users' }
      );
      expect(result).toEqual(createMockErrorResponse());
    });
  });

  describe('error propagation', () => {
    it('rethrows non-database errors', async () => {
      const genericError = new Error('Some other error');
      mockNext.mockRejectedValue(genericError);

      await expect(dbErrorMiddleware(mockCtx, mockNext)).rejects.toThrow(genericError);
    });

    it('rethrows AppError', async () => {
      const appError = new AppError('NOT_FOUND', 'Not found');
      mockNext.mockRejectedValue(appError);

      await expect(dbErrorMiddleware(mockCtx, mockNext)).rejects.toThrow(appError);
    });

    it('rethrows non-Error values', async () => {
      mockNext.mockRejectedValue('string error');

      await expect(dbErrorMiddleware(mockCtx, mockNext)).rejects.toBe('string error');
    });
  });

  describe('success path', () => {
    it('lets successful requests pass through', async () => {
      mockNext.mockResolvedValue('success');

      const result = await dbErrorMiddleware(mockCtx, mockNext);

      expect(result).toBe('success');
      expect(errorResponse).not.toHaveBeenCalled();
    });
  });
});
