/**
 * Process-global task lifecycle bus.
 *
 * TaskService instances are constructed ad-hoc all over the codebase (tool
 * bridge, executors, routes), so lifecycle consumers subscribe here instead of
 * holding a service reference. Listeners must never throw into task flow.
 */
import { EventEmitter } from 'events';
import type { TaskRecord } from '@zclaudia/shared/core/task';

export interface TaskLifecycleEvent {
  /** 'started' on queued→running; 'settled' on any terminal transition. */
  type: 'started' | 'settled';
  task: TaskRecord;
}

const bus = new EventEmitter();
bus.setMaxListeners(50);

const EVENT = 'task-lifecycle';

export function emitTaskLifecycle(event: TaskLifecycleEvent): void {
  try {
    bus.emit(EVENT, event);
  } catch (err) {
    console.warn('[TaskEventsBus] listener threw:', err);
  }
}

export function onTaskLifecycle(listener: (event: TaskLifecycleEvent) => void): () => void {
  const safe = (event: TaskLifecycleEvent) => {
    try {
      listener(event);
    } catch (err) {
      console.warn('[TaskEventsBus] listener threw:', err);
    }
  };
  bus.on(EVENT, safe);
  return () => bus.off(EVENT, safe);
}
