import { describe, expect, it, vi } from 'vitest';
import { startSkillChangeWatcher } from '../skill-change-watcher.js';

describe('skill-change-watcher', () => {
  it('debounces SKILL.md changes and refreshes the skill cache', async () => {
    vi.useFakeTimers();
    const close = vi.fn();
    const watch = vi.fn((_path: string, _options: unknown, listener: (event: string, filename: string) => void) => {
      listener('change', 'demo/SKILL.md');
      listener('rename', 'demo/SKILL.md');
      return { close };
    });
    const refresh = vi.fn().mockResolvedValue(2);

    const watcher = startSkillChangeWatcher({
      watchPaths: ['/workspace/skills'],
      debounceMs: 100,
      watch: watch as never,
      exists: () => true,
      refresh,
    });

    await vi.advanceTimersByTimeAsync(99);
    expect(refresh).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledWith();
    watcher.stop();
    expect(close).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('ignores non-skill file changes', async () => {
    vi.useFakeTimers();
    const watch = vi.fn((_path: string, _options: unknown, listener: (event: string, filename: string) => void) => {
      listener('change', 'README.md');
      return { close: vi.fn() };
    });
    const refresh = vi.fn().mockResolvedValue(0);

    startSkillChangeWatcher({
      watchPaths: ['/workspace/skills'],
      debounceMs: 100,
      watch: watch as never,
      exists: () => true,
      refresh,
    });

    await vi.advanceTimersByTimeAsync(100);
    expect(refresh).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
