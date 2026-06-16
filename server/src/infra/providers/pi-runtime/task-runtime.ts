import type { TaskRecord } from '@zclaudia/shared/core/task';

import type { TaskExecutorUpdate } from '../../../domains/tasks/executors/types.js';
import type { ToolContent } from './tool-common.js';

export type TaskToolResult = {
  content: ToolContent;
  details: Record<string, unknown>;
};

export interface TaskRuntime {
  readonly type: string;
  stop?(task: TaskRecord, reason?: string): Promise<TaskExecutorUpdate>;
  readOutput?(task: TaskRecord, args: Record<string, unknown>): Promise<TaskToolResult>;
  reconcile?(): void;
}

export interface TaskRuntimeRegistry {
  register(runtime: TaskRuntime): void;
  get(type: string): TaskRuntime | undefined;
  list(): TaskRuntime[];
}

export function createTaskRuntimeRegistry(runtimes: TaskRuntime[] = []): TaskRuntimeRegistry {
  const byType = new Map<string, TaskRuntime>();
  const registry: TaskRuntimeRegistry = {
    register(runtime) {
      byType.set(runtime.type, runtime);
    },
    get(type) {
      return byType.get(type);
    },
    list() {
      return [...byType.values()];
    },
  };
  for (const runtime of runtimes) registry.register(runtime);
  return registry;
}
