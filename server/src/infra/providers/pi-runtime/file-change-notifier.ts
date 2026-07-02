import {
  mergeWriteLifecycleResults,
  type WriteLifecycleHooks,
  type WriteLifecycleInput,
  type WriteLifecycleResult,
} from './write-lifecycle.js';

export interface FileChangeNotification {
  path: string;
  absolutePath: string;
  changeKind: 'create' | 'modify';
  operation: WriteLifecycleInput['operation'];
  diff: string;
  firstChangedLine?: number;
}

export interface FileChangeNotifier {
  notifyFileChanged(event: FileChangeNotification): Promise<void> | void;
  timeoutMs?: number;
}

export function createFileChangeLifecycleHooks(
  notifier: FileChangeNotifier | undefined
): WriteLifecycleHooks | undefined {
  if (!notifier) return undefined;
  return {
    timeoutMs: notifier.timeoutMs,
    afterWrite: async input => {
      await notifier.notifyFileChanged({
        path: input.path,
        absolutePath: input.absolutePath,
        changeKind: input.type === 'create' ? 'create' : 'modify',
        operation: input.operation,
        diff: input.diff,
        ...(input.firstChangedLine !== undefined
          ? { firstChangedLine: input.firstChangedLine }
          : {}),
      });
      return { notifications: [`file_change_notified:${input.path}`] };
    },
  };
}

export function composeWriteLifecycleHooks(
  first: WriteLifecycleHooks | undefined,
  second: WriteLifecycleHooks | undefined
): WriteLifecycleHooks | undefined {
  if (!first) return second;
  if (!second) return first;
  return {
    timeoutMs: first.timeoutMs ?? second.timeoutMs,
    afterWrite: async (input): Promise<WriteLifecycleResult | undefined> => {
      const firstResult = first.afterWrite ? await first.afterWrite(input) : undefined;
      const secondResult = second.afterWrite ? await second.afterWrite(input) : undefined;
      return mergeWriteLifecycleResults(firstResult ?? undefined, secondResult ?? undefined);
    },
  };
}
