import { describe, it, expect } from 'vitest';
import { LOCAL_BACKEND_KEY } from '../../../stores/sessionsStore';
import { selectHomeSessions, type HomeSessionsInput } from '../homeSessions';

function session(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    projectId: 'p1',
    type: 'regular',
    createdAt: 1000,
    updatedAt: 1000,
    ...over,
  } as any;
}

const projects = [
  { id: 'p1', name: 'zclaudia' },
  { id: 'p2', name: 'gateway' },
] as any[];

function input(over: Partial<HomeSessionsInput> = {}): HomeSessionsInput {
  return {
    localSessions: [],
    remoteSessions: new Map(),
    activeSessionIdsByBackend: new Map(),
    projects,
    localAliasBackendIds: new Set(),
    isVisibleGatewayBackend: () => true,
    ...over,
  };
}

describe('selectHomeSessions', () => {
  it('sorts recent sessions by updatedAt descending across backends', () => {
    const result = selectHomeSessions(
      input({
        localSessions: [session('a', { updatedAt: 100 })],
        remoteSessions: new Map([['b1', [session('b', { updatedAt: 300, projectId: 'p2' })]]]),
      })
    );
    expect(result.recent.map(r => r.id)).toEqual(['b', 'a']);
    expect(result.recent[0].backendKey).toBe('b1');
    expect(result.recent[1].backendKey).toBe(LOCAL_BACKEND_KEY);
  });

  it('dedupes local gateway aliases, preferring the local copy', () => {
    const result = selectHomeSessions(
      input({
        localSessions: [session('a', { name: 'from-local' })],
        remoteSessions: new Map([['alias1', [session('a', { name: 'from-gateway' })]]]),
        localAliasBackendIds: new Set(['alias1']),
      })
    );
    expect(result.recent).toHaveLength(1);
    expect(result.recent[0].title).toBe('from-local');
    expect(result.recent[0].backendKey).toBe(LOCAL_BACKEND_KEY);
  });

  it('partitions running sessions using activeSessionIdsByBackend, union of local aliases', () => {
    const result = selectHomeSessions(
      input({
        localSessions: [session('a'), session('b')],
        activeSessionIdsByBackend: new Map([['alias1', new Set(['a'])]]),
        localAliasBackendIds: new Set(['alias1']),
      })
    );
    expect(result.running.map(r => r.id)).toEqual(['a']);
    expect(result.recent.map(r => r.id)).toEqual(['b']);
    expect(result.running[0].isRunning).toBe(true);
  });

  it('filters archived, non-regular, and orphaned-project sessions', () => {
    const result = selectHomeSessions(
      input({
        localSessions: [
          session('ok'),
          session('archived', { archivedAt: 5 }),
          session('bg', { type: 'background' }),
          session('orphan', { projectId: 'nope' }),
        ],
      })
    );
    expect(result.recent.map(r => r.id)).toEqual(['ok']);
  });

  it('excludes sessions of internal projects', () => {
    const result = selectHomeSessions(
      input({
        projects: [...projects, { id: 'pi', name: '__claudia', isInternal: true }] as any[],
        localSessions: [session('a'), session('i', { projectId: 'pi' })],
      })
    );
    expect(result.recent.map(r => r.id)).toEqual(['a']);
  });

  it('treats a missing type as regular', () => {
    const result = selectHomeSessions(
      input({ localSessions: [session('a', { type: undefined })] })
    );
    expect(result.recent.map(r => r.id)).toEqual(['a']);
  });

  it('skips gateway backends rejected by the visibility predicate', () => {
    const result = selectHomeSessions(
      input({
        remoteSessions: new Map([
          ['visible', [session('a')]],
          ['hidden', [session('b')]],
        ]),
        isVisibleGatewayBackend: id => id === 'visible',
      })
    );
    expect(result.recent.map(r => r.id)).toEqual(['a']);
  });

  it('caps recent at 10 but does not cap running', () => {
    const many = Array.from({ length: 15 }, (_, i) =>
      session(`s${i}`, { updatedAt: 1000 + i })
    );
    const result = selectHomeSessions(
      input({
        localSessions: many,
        activeSessionIdsByBackend: new Map([[LOCAL_BACKEND_KEY, new Set(['s0', 's1'])]]),
      })
    );
    expect(result.running).toHaveLength(2);
    expect(result.recent).toHaveLength(10);
    expect(result.recent[0].id).toBe('s14');
  });

  it('falls back title through autoTitle, name, then Untitled', () => {
    const result = selectHomeSessions(
      input({
        localSessions: [
          session('a', { autoTitle: 'Auto', name: 'Named', updatedAt: 3 }),
          session('b', { name: 'Named', updatedAt: 2 }),
          session('c', { updatedAt: 1 }),
        ],
      })
    );
    expect(result.recent.map(r => r.title)).toEqual(['Auto', 'Named', 'Untitled']);
  });

  it('resolves project names and flags multiBackend only with >1 distinct backend', () => {
    const single = selectHomeSessions(input({ localSessions: [session('a')] }));
    expect(single.multiBackend).toBe(false);
    expect(single.recent[0].projectName).toBe('zclaudia');

    const multi = selectHomeSessions(
      input({
        localSessions: [session('a')],
        remoteSessions: new Map([['b1', [session('b', { projectId: 'p2' })]]]),
      })
    );
    expect(multi.multiBackend).toBe(true);
  });
});
