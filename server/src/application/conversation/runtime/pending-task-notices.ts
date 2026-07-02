/**
 * Per-session queue of background-task settlement notices.
 *
 * When a task finishes while its session has no active (steerable) run, the
 * notice waits here and is appended to the provider input of the session's
 * next run. In-memory only: a server restart drops pending notices, but the
 * task results themselves stay in the tasks table and remain pollable.
 */

const noticesBySession = new Map<string, string[]>();

const MAX_NOTICES_PER_SESSION = 20;

export function addPendingTaskNotice(sessionId: string, notice: string): void {
  const queue = noticesBySession.get(sessionId) ?? [];
  queue.push(notice);
  if (queue.length > MAX_NOTICES_PER_SESSION)
    queue.splice(0, queue.length - MAX_NOTICES_PER_SESSION);
  noticesBySession.set(sessionId, queue);
}

export function drainPendingTaskNotices(sessionId: string): string[] {
  const queue = noticesBySession.get(sessionId) ?? [];
  noticesBySession.delete(sessionId);
  return queue;
}

export function __resetPendingTaskNoticesForTests(): void {
  noticesBySession.clear();
}
