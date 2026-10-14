import type { DeltaMessage, ServerMessage } from '@zclaudia/shared/wire/messages';

export interface RunDeltaBatcherOptions {
  /** Maximum time text waits before being sent, even when no more deltas arrive. */
  maxDelayMs?: number;
  /** Maximum merged text size before the current batch is sent. */
  maxContentChars?: number;
}

type PendingDelta = DeltaMessage;

const DEFAULT_MAX_DELAY_MS = 50;
const DEFAULT_MAX_CONTENT_CHARS = 512;

/**
 * Coalesces adjacent text deltas before the run sender assigns event sequence
 * numbers. The aggregate therefore consumes one wire sequence number and is
 * compatible with clients that only understand single-event sequencing.
 * Any non-delta message flushes synchronously before it is sent.
 */
export function createRunDeltaBatcher(
  send: (message: ServerMessage) => void,
  options: RunDeltaBatcherOptions = {}
): { send: (message: ServerMessage) => void; flush: () => void } {
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const maxContentChars = options.maxContentChars ?? DEFAULT_MAX_CONTENT_CHARS;
  let pending: PendingDelta | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const flush = (): void => {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
    if (!pending) return;
    const batch = pending;
    pending = undefined;
    send(batch);
  };

  const startTimer = (): void => {
    timer = setTimeout(flush, maxDelayMs);
  };

  const sendMessage = (message: ServerMessage): void => {
    if (message.type !== 'delta' || !message.content) {
      flush();
      send(message);
      return;
    }

    if (message.content.length >= maxContentChars) {
      flush();
      send(message);
      return;
    }

    const previous = pending;
    const isAdjacent =
      previous &&
      previous.runId === message.runId &&
      previous.sessionId === message.sessionId &&
      previous.content.length + message.content.length <= maxContentChars;

    if (!isAdjacent) flush();

    if (isAdjacent) {
      pending!.content += message.content;
      return;
    }

    pending = {
      type: 'delta',
      runId: message.runId,
      sessionId: message.sessionId,
      content: message.content,
    };
    startTimer();
  };

  return { send: sendMessage, flush };
}
