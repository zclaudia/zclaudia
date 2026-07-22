import type { TaskRepository } from '../repository.js';
import { TaskService } from '../task-service.js';

/**
 * Reason recorded on tasks settled by the startup reconcile below. Stable and
 * machine-readable so TaskOutput/UI can distinguish a restart-settled task
 * from a user- or executor-initiated stop.
 */
export const SERVER_RESTARTED_REASON = 'server_restarted';

/**
 * Startup reconcile for task types that can NEVER resume after a server
 * restart (P1-7):
 *
 * - 'agent' tasks are driven by AgentTaskExecutor.pendingRuns, an in-memory
 *   map — after a restart nothing exists that could resolve them, so a row
 *   left queued/running/paused would wait forever.
 * - 'monitor' tasks never had a runtime at all (the Monitor tool's start
 *   action is now disabled): rows left non-terminal from before that change
 *   are zombies.
 *
 * Command and eval tasks are NOT touched here — their own runtimes reconcile
 * by pid liveness (see CommandTaskExecutor.reconcile / EvalTaskRuntime.reconcile).
 */
export function reconcileUnresumableTasks(repo: TaskRepository): void {
  const service = new TaskService(repo);
  for (const type of ['agent', 'monitor'] as const) {
    for (const task of repo.listByTypeAndStatuses(type, ['queued', 'running', 'paused'])) {
      try {
        service.stopTask(task.id, { error: SERVER_RESTARTED_REASON });
      } catch {
        // best-effort: a concurrent settler may have finalized the task first
      }
    }
  }
}
