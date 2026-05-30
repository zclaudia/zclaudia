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

import type { ExecutorInstance } from '@zclaudia/shared/features/executor';
import type { IExecutor } from '@zclaudia/shared/features/executor';

/** Factory signature each adapter provides. */
export type ExecutorFactory = (instance: ExecutorInstance) => IExecutor;
