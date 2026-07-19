import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  PhaseEmitter,
  setPhase,
  recomputePhase,
  waitForIdle,
  isTerminalPhase,
  isValidTransition,
  type RunPhase,
} from '../active-run-phase.js';

function makeHolder(initial: RunPhase = 'running') {
  return {
    phase: initial,
    phaseEmitter: new PhaseEmitter(),
    runId: 'test-run',
  };
}

describe('isTerminalPhase', () => {
  it('returns true for completed / cancelled / failed', () => {
    expect(isTerminalPhase('completed')).toBe(true);
    expect(isTerminalPhase('cancelled')).toBe(true);
    expect(isTerminalPhase('failed')).toBe(true);
  });

  it('returns false for non-terminal phases', () => {
    expect(isTerminalPhase('running')).toBe(false);
    expect(isTerminalPhase('awaiting_permission')).toBe(false);
    expect(isTerminalPhase('awaiting_followup')).toBe(false);
    expect(isTerminalPhase('cancelling')).toBe(false);
    expect(isTerminalPhase('finalizing')).toBe(false);
  });
});

describe('isValidTransition', () => {
  it('running can go to any non-running state', () => {
    expect(isValidTransition('running', 'awaiting_permission')).toBe(true);
    expect(isValidTransition('running', 'awaiting_followup')).toBe(true);
    expect(isValidTransition('running', 'cancelling')).toBe(true);
    expect(isValidTransition('running', 'finalizing')).toBe(true);
    expect(isValidTransition('running', 'completed')).toBe(true);
    expect(isValidTransition('running', 'failed')).toBe(true);
  });

  it('finalizing can only publish a terminal success or failure', () => {
    expect(isValidTransition('finalizing', 'completed')).toBe(true);
    expect(isValidTransition('finalizing', 'failed')).toBe(true);
    expect(isValidTransition('finalizing', 'running')).toBe(false);
  });

  it('awaiting_permission and awaiting_followup can interchange and return to running', () => {
    expect(isValidTransition('awaiting_permission', 'running')).toBe(true);
    expect(isValidTransition('awaiting_permission', 'awaiting_followup')).toBe(true);
    expect(isValidTransition('awaiting_followup', 'awaiting_permission')).toBe(true);
    expect(isValidTransition('awaiting_followup', 'running')).toBe(true);
  });

  it('cancelling only goes to cancelled or failed', () => {
    expect(isValidTransition('cancelling', 'cancelled')).toBe(true);
    expect(isValidTransition('cancelling', 'failed')).toBe(true);
    expect(isValidTransition('cancelling', 'running')).toBe(false);
    expect(isValidTransition('cancelling', 'completed')).toBe(false);
  });

  it('terminal phases have no valid transitions', () => {
    for (const from of ['completed', 'cancelled', 'failed'] as RunPhase[]) {
      for (const to of [
        'running',
        'awaiting_permission',
        'cancelling',
        'completed',
      ] as RunPhase[]) {
        expect(isValidTransition(from, to)).toBe(false);
      }
    }
  });
});

describe('PhaseEmitter', () => {
  it('invokes listeners with (next, prev) on emit', () => {
    const e = new PhaseEmitter();
    const fn = vi.fn();
    e.onChange(fn);
    e.emit('completed', 'running');
    expect(fn).toHaveBeenCalledWith('completed', 'running');
  });

  it('unsubscribe stops further calls', () => {
    const e = new PhaseEmitter();
    const fn = vi.fn();
    const off = e.onChange(fn);
    off();
    e.emit('completed', 'running');
    expect(fn).not.toHaveBeenCalled();
  });

  it('one listener throwing does not break others', () => {
    const e = new PhaseEmitter();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const good = vi.fn();
    e.onChange(() => {
      throw new Error('boom');
    });
    e.onChange(good);
    e.emit('completed', 'running');
    expect(good).toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('PhaseEmitter'),
      expect.any(Error)
    );
    warnSpy.mockRestore();
  });
});

describe('setPhase', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('same phase is a noop (no emit)', () => {
    const h = makeHolder('running');
    const fn = vi.fn();
    h.phaseEmitter.onChange(fn);
    setPhase(h, 'running');
    expect(h.phase).toBe('running');
    expect(fn).not.toHaveBeenCalled();
  });

  it('valid transition updates phase and emits', () => {
    const h = makeHolder('running');
    const fn = vi.fn();
    h.phaseEmitter.onChange(fn);
    setPhase(h, 'completed');
    expect(h.phase).toBe('completed');
    expect(fn).toHaveBeenCalledWith('completed', 'running');
  });

  it('invalid transition in dev mode throws', () => {
    process.env.NODE_ENV = 'development';
    const h = makeHolder('completed');
    expect(() => setPhase(h, 'running')).toThrow(/illegal phase transition: completed.*running/);
  });

  it('invalid transition in prod warns and refuses', () => {
    process.env.NODE_ENV = 'production';
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const h = makeHolder('completed');
    setPhase(h, 'running');
    expect(h.phase).toBe('completed'); // unchanged
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('illegal phase transition'));
    warnSpy.mockRestore();
  });

  it('terminal phase refuses any subsequent transition (prod)', () => {
    process.env.NODE_ENV = 'production';
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const h = makeHolder('failed');
    setPhase(h, 'running');
    setPhase(h, 'completed');
    expect(h.phase).toBe('failed');
    warnSpy.mockRestore();
  });
});

describe('recomputePhase', () => {
  it('prefers cancelling over everything else', () => {
    const h = makeHolder('running');
    recomputePhase(h, {
      isCancelling: true,
      hasPendingPermissions: true,
      hasPendingFollowups: true,
    });
    expect(h.phase).toBe('cancelling');
  });

  it('prefers awaiting_permission over followup', () => {
    const h = makeHolder('running');
    recomputePhase(h, {
      isCancelling: false,
      hasPendingPermissions: true,
      hasPendingFollowups: true,
    });
    expect(h.phase).toBe('awaiting_permission');
  });

  it('falls back to running when no blockers', () => {
    const h = makeHolder('awaiting_permission');
    recomputePhase(h, {
      isCancelling: false,
      hasPendingPermissions: false,
      hasPendingFollowups: false,
    });
    expect(h.phase).toBe('running');
  });

  it('terminal phases are sticky (no-op)', () => {
    const h = makeHolder('completed');
    recomputePhase(h, {
      isCancelling: true,
      hasPendingPermissions: true,
      hasPendingFollowups: true,
    });
    expect(h.phase).toBe('completed');
  });
});

describe('waitForIdle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves synchronously if already terminal', async () => {
    const h = makeHolder('completed');
    await expect(waitForIdle(h)).resolves.toBe('completed');
  });

  it('resolves with terminal phase when reached', async () => {
    const h = makeHolder('running');
    const p = waitForIdle(h);
    setPhase(h, 'completed');
    await expect(p).resolves.toBe('completed');
  });

  it('resolves with failed when run errors', async () => {
    const h = makeHolder('running');
    const p = waitForIdle(h);
    setPhase(h, 'failed');
    await expect(p).resolves.toBe('failed');
  });

  it('resolves with cancelled when user cancels and cleanup finishes', async () => {
    const h = makeHolder('running');
    const p = waitForIdle(h);
    setPhase(h, 'cancelling');
    setPhase(h, 'cancelled');
    await expect(p).resolves.toBe('cancelled');
  });

  it('rejects on timeout if no terminal reached', async () => {
    const h = makeHolder('running');
    const p = waitForIdle(h, { timeoutMs: 100 });
    vi.advanceTimersByTime(150);
    await expect(p).rejects.toThrow(/timed out after 100ms/);
  });

  it('multiple concurrent awaits all resolve', async () => {
    const h = makeHolder('running');
    const p1 = waitForIdle(h);
    const p2 = waitForIdle(h);
    setPhase(h, 'completed');
    await expect(p1).resolves.toBe('completed');
    await expect(p2).resolves.toBe('completed');
  });
});
