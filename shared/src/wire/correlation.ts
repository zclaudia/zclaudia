/**
 * Request-Response Correlation Protocol
 *
 * This module defines the core types for correlating requests and responses
 * in the WebSocket messaging system. It enables:
 * - Matching responses to specific requests
 * - Request timeouts and retries
 * - Proper async/await patterns
 * - Type-safe request-response pairs
 */

/**
 * Base correlated message envelope
 */
export interface CorrelatedMessage<T = unknown> {
  id: string; // Unique message ID (correlation ID)
  type: string; // Message type
  payload: T; // Actual message data
  timestamp: number; // Message timestamp
  metadata?: {
    requestId?: string; // For responses: ID of the original request
    timeout?: number; // Timeout in ms
  };
}

/**
 * Request envelope - client to server
 */
export interface Request<T = unknown> extends CorrelatedMessage<T> {
  metadata: {
    timeout: number; // Default 30000ms
    requiresAuth?: boolean;
  };
}

/**
 * Response envelope - server to client
 */
export interface Response<T = unknown> extends CorrelatedMessage<T> {
  metadata: {
    requestId: string; // Correlation to request
    success: boolean;
    error?: {
      code: string;
      message: string;
      details?: unknown;
    };
  };
}

/**
 * Streaming message - server push updates for long-running operations
 */
export interface StreamMessage<T = unknown> extends CorrelatedMessage<T> {
  metadata: {
    requestId: string; // Correlation to request
    sequence: number; // Ordered sequence number
    final: boolean; // Is this the last message?
  };
}

/**
 * Event - server-initiated notification (no request correlation)
 */
export interface Event<T = unknown> {
  id: string;
  type: string;
  payload: T;
  timestamp: number;
  metadata?: {
    broadcast?: boolean; // Broadcast to all clients
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object';
}

/**
 * Type guard: Check if message is a Request
 */
export function isRequest(msg: unknown): msg is Request {
  if (!isRecord(msg) || !isRecord(msg.metadata)) return false;

  return (
    'id' in msg &&
    'type' in msg &&
    'payload' in msg &&
    'timestamp' in msg &&
    typeof msg.metadata.timeout === 'number'
  );
}

/**
 * Type guard: Check if message is a Response
 */
export function isResponse(msg: unknown): msg is Response {
  if (!isRecord(msg) || !isRecord(msg.metadata)) return false;

  return (
    'metadata' in msg &&
    typeof msg.metadata.requestId === 'string' &&
    typeof msg.metadata.success === 'boolean'
  );
}

/**
 * Type guard: Check if message is a StreamMessage
 */
export function isStreamMessage(msg: unknown): msg is StreamMessage {
  if (!isRecord(msg) || !isRecord(msg.metadata)) return false;

  return (
    'metadata' in msg &&
    typeof msg.metadata.requestId === 'string' &&
    typeof msg.metadata.sequence === 'number' &&
    typeof msg.metadata.final === 'boolean'
  );
}

/**
 * Type guard: Check if message is an Event
 */
export function isEvent(msg: unknown): msg is Event {
  if (!isRecord(msg)) return false;
  const metadata = msg.metadata;

  return (
    'id' in msg &&
    'type' in msg &&
    'payload' in msg &&
    !isRequest(msg) &&
    (!isRecord(metadata) || typeof metadata.requestId !== 'string')
  );
}

/**
 * Create a Request from a payload
 */
export function createRequest<T>(
  type: string,
  payload: T,
  options?: {
    id?: string;
    timeout?: number;
    requiresAuth?: boolean;
  }
): Request<T> {
  return {
    id: options?.id || generateId(),
    type,
    payload,
    timestamp: Date.now(),
    metadata: {
      timeout: options?.timeout || 30000,
      requiresAuth: options?.requiresAuth,
    },
  };
}

/**
 * Create a Response from a Request
 */
export function createResponse<T>(
  request: Request,
  payload: T,
  options?: {
    success?: boolean;
    error?: {
      code: string;
      message: string;
      details?: unknown;
    };
  }
): Response<T> {
  return {
    id: generateId(),
    type: request.type.replace('.request', '.response'),
    payload,
    timestamp: Date.now(),
    metadata: {
      requestId: request.id,
      success: options?.success !== false,
      error: options?.error,
    },
  };
}

/**
 * Generate a unique ID for messages
 * Uses simple timestamp + random for universally compatible ID generation
 */
function generateId(): string {
  // Use timestamp + random for compatibility across all environments
  return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}${Math.random().toString(36).substring(2, 15)}`;
}
