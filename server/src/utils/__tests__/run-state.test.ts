import { describe, it, expect } from 'vitest';
import {
  isForegroundActiveRun,
  hasForegroundActiveRunForSession,
  findForegroundActiveRunIdForSession,
  hasAnyActiveRunForSession,
} from '../run-state.js';

describe('run-state helpers', () => {
  it('treats only non-terminal non-background as foreground active', () => {
    expect(isForegroundActiveRun(undefined)).toBe(false);
    expect(isForegroundActiveRun({ phase: 'running', sessionType: 'regular' })).toBe(true);
    expect(isForegroundActiveRun({ phase: 'completed', sessionType: 'regular' })).toBe(false);
    expect(isForegroundActiveRun({ phase: 'cancelled', sessionType: 'regular' })).toBe(false);
    expect(isForegroundActiveRun({ phase: 'failed', sessionType: 'regular' })).toBe(false);
    expect(isForegroundActiveRun({ phase: 'awaiting_permission', sessionType: 'regular' })).toBe(true);
    expect(isForegroundActiveRun({ phase: 'running', sessionType: 'background' })).toBe(false);
    expect(isForegroundActiveRun({ phase: 'running' })).toBe(true);
  });

  it('detects active session with unified logic', () => {
    const runs = new Map<string, any>([
      ['r1', { sessionId: 's1', phase: 'completed', sessionType: 'regular' }],
      ['r2', { sessionId: 's1', phase: 'running', sessionType: 'background' }],
      ['r3', { sessionId: 's2', phase: 'running', sessionType: 'regular' }],
    ]);

    expect(hasForegroundActiveRunForSession(runs, 's1')).toBe(false);
    expect(hasForegroundActiveRunForSession(runs, 's2')).toBe(true);
  });

  it('finds run id only for foreground active run', () => {
    const runs = new Map<string, any>([
      ['r1', { sessionId: 's1', phase: 'completed', sessionType: 'regular' }],
      ['r2', { sessionId: 's1', phase: 'running', sessionType: 'regular' }],
    ]);

    expect(findForegroundActiveRunIdForSession(runs, 's1')).toBe('r2');
    expect(findForegroundActiveRunIdForSession(runs, 'missing')).toBeNull();
  });

  it('hasAnyActiveRunForSession includes background runs', () => {
    const runs = new Map<string, any>([
      ['r1', { sessionId: 's1', phase: 'running', sessionType: 'background' }],
      ['r2', { sessionId: 's2', phase: 'completed', sessionType: 'regular' }],
    ]);

    expect(hasAnyActiveRunForSession(runs, 's1')).toBe(true);
    expect(hasAnyActiveRunForSession(runs, 's2')).toBe(false);
    expect(hasAnyActiveRunForSession(runs, 'missing')).toBe(false);
  });

  it('hasAnyActiveRunForSession returns false for empty map', () => {
    expect(hasAnyActiveRunForSession(new Map(), 's1')).toBe(false);
  });
});
