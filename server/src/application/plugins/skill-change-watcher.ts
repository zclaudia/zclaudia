import { existsSync, watch as fsWatch, type FSWatcher } from 'node:fs';
import path from 'node:path';

export interface SkillChangeWatcher {
  stop(): void;
}

export interface StartSkillChangeWatcherOptions {
  watchPaths: string[];
  debounceMs?: number;
  watch?: typeof fsWatch;
  exists?: (path: string) => boolean;
  refresh: () => Promise<unknown>;
  onError?: (error: unknown) => void;
}

function isSkillFile(filename: string | Buffer | null): boolean {
  if (!filename) return true;
  const normalized = filename.toString().replaceAll('\\', '/');
  return path.basename(normalized) === 'SKILL.md';
}

export function startSkillChangeWatcher(options: StartSkillChangeWatcherOptions): SkillChangeWatcher {
  const watch = options.watch ?? fsWatch;
  const exists = options.exists ?? existsSync;
  const debounceMs = options.debounceMs ?? 300;
  const onError = options.onError ?? ((error) => console.warn('[SkillWatcher] refresh failed:', error));
  const watchers: FSWatcher[] = [];
  let timer: NodeJS.Timeout | undefined;
  let refreshing = false;
  let queued = false;

  const runRefresh = () => {
    if (refreshing) {
      queued = true;
      return;
    }
    refreshing = true;
    void options.refresh()
      .catch(onError)
      .finally(() => {
        refreshing = false;
        if (queued) {
          queued = false;
          scheduleRefresh();
        }
      });
  };

  const scheduleRefresh = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      runRefresh();
    }, debounceMs);
  };

  for (const watchPath of [...new Set(options.watchPaths)].filter(Boolean)) {
    if (!exists(watchPath)) continue;
    try {
      const watcher = watch(watchPath, { recursive: true }, (_event, filename) => {
        if (isSkillFile(filename)) scheduleRefresh();
      });
      watchers.push(watcher);
    } catch (error) {
      onError(error);
    }
  }

  return {
    stop() {
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      for (const watcher of watchers) watcher.close();
      watchers.splice(0, watchers.length);
    },
  };
}
