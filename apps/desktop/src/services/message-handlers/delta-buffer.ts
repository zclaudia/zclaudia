import { useChatStore } from '../../stores/chatStore';

/**
 * Coalesce streaming `delta` events into one chatStore commit per animation
 * frame. Each `delta` would otherwise re-parse the entire (growing) assistant
 * message through react-markdown, and at fast streaming rates the render
 * queue backs up well past `run_completed`. Users perceive the spinner
 * disappearing while text continues to "type" in for hundreds of
 * milliseconds.
 *
 * Buffer per runId so multiple in-flight runs don't merge.
 * Flush is synchronous on rAF tick. Terminal events (`run_completed` /
 * `run_failed`) MUST call {@link flushDeltaForRun} before mutating
 * messages so the visible text is current before finalization.
 */

interface PendingDelta {
  sessionId: string;
  content: string;
}

const pendingByRun = new Map<string, PendingDelta>();
let scheduledHandle: number | null = null;

function flushAll(): void {
  scheduledHandle = null;
  if (pendingByRun.size === 0) return;
  // Snapshot before commit so new deltas arriving synchronously during
  // chatStore.set don't get dropped — they'll be picked up by the next rAF.
  const snapshot = Array.from(pendingByRun.entries());
  pendingByRun.clear();
  const chat = useChatStore.getState();
  for (const [runId, { sessionId, content }] of snapshot) {
    chat.appendToLastMessage(sessionId, content);
    chat.appendTextBlock(runId, content);
  }
}

function schedule(): void {
  if (scheduledHandle !== null) return;
  if (typeof requestAnimationFrame === 'function') {
    scheduledHandle = requestAnimationFrame(flushAll);
  } else {
    // Non-browser (SSR, jsdom without rAF): fall back to microtask so flush
    // still happens and tests don't need a special harness.
    scheduledHandle = 1;
    queueMicrotask(flushAll);
  }
}

/**
 * Buffer a `delta` event for the next animation frame. Successive calls for
 * the same runId concatenate their content.
 */
export function scheduleDelta(sessionId: string, runId: string, content: string): void {
  if (!content) return;
  const existing = pendingByRun.get(runId);
  if (existing) {
    existing.content += content;
  } else {
    pendingByRun.set(runId, { sessionId, content });
  }
  schedule();
}

/**
 * Synchronously flush any pending delta for `runId` into chatStore. Call
 * before processing terminal lifecycle events (run_completed / run_failed)
 * so the message reflects all received text before finalization.
 */
export function flushDeltaForRun(runId: string): void {
  const pending = pendingByRun.get(runId);
  if (!pending) return;
  pendingByRun.delete(runId);
  const chat = useChatStore.getState();
  chat.appendToLastMessage(pending.sessionId, pending.content);
  chat.appendTextBlock(runId, pending.content);
}

/**
 * Test-only hook: clear all buffered state. Production code should never
 * call this — terminal events flush per-run.
 */
export function __resetDeltaBufferForTests(): void {
  pendingByRun.clear();
  if (scheduledHandle !== null && typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(scheduledHandle);
  }
  scheduledHandle = null;
}
