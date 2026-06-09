import type { TaskType } from '@zclaudia/shared/core/task';

import type { TaskExecutor } from './types.js';

export class TaskExecutorRegistry {
  private readonly executors = new Map<TaskType, TaskExecutor>();

  register(executor: TaskExecutor): void {
    this.executors.set(executor.type, executor);
  }

  get(type: TaskType): TaskExecutor | undefined {
    return this.executors.get(type);
  }

  getRequired(type: TaskType): TaskExecutor {
    const executor = this.get(type);
    if (!executor) {
      throw new Error(`No task executor registered: ${type}`);
    }
    return executor;
  }
}
