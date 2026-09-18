// server/src/domains/executor/executor-port.ts
// Re-exports the IExecutor port from shared, plus server-side helpers.

export type {
  IExecutor,
  ExecutorInput,
  ExecutorProgress,
  ExecutorStatus,
  ExecutorType,
  GitCommit,
} from '@zclaudia/shared/features/executor';

import type { ExecutorInstance, ExecutorInput } from '@zclaudia/shared/features/executor';
import type { IExecutor } from '@zclaudia/shared/features/executor';

/** Factory signature each adapter provides. */
export type ExecutorFactory = (instance: ExecutorInstance) => IExecutor;

/**
 * Lifecycle operations the executor HTTP surface needs. Implemented by the
 * issue-orchestration domain's ExecutorService; keeping the port here lets the
 * routes depend on the executor domain alone.
 */
export interface ExecutorServicePort {
  start(executorInstanceId: string, input?: ExecutorInput): Promise<void>;
  pause(executorInstanceId: string): Promise<void>;
  resume(executorInstanceId: string): Promise<void>;
  cancel(executorInstanceId: string): Promise<void>;
  markCompleted(executorInstanceId: string): Promise<void>;
  refresh(executorInstanceId: string): Promise<void>;
}
