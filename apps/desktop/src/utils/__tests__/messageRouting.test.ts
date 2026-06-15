import { describe, it, expect } from 'vitest';
import { resolveMessageTarget, type MessageTargetResolver } from '../messageRouting';

function makeResolver(over: Partial<MessageTargetResolver> = {}): MessageTargetResolver {
  return {
    getSessionBackendId: () => null,
    getProjectBackendId: () => null,
    fallbackBackendId: 'backend-a',
    ...over,
  };
}

describe('resolveMessageTarget', () => {
  it('routes to the session owner when the message carries a sessionId', () => {
    const target = resolveMessageTarget(
      { type: 'rename_session', sessionId: 's1', name: 'x' } as any,
      makeResolver({ getSessionBackendId: (id) => (id === 's1' ? 'backend-b' : null) }),
    );
    expect(target).toBe('backend-b');
  });

  it('routes to the project owner when there is a projectId but no sessionId', () => {
    const target = resolveMessageTarget(
      { type: 'create_session', projectId: 'p1' } as any,
      makeResolver({ getProjectBackendId: (id) => (id === 'p1' ? 'backend-c' : null) }),
    );
    expect(target).toBe('backend-c');
  });

  it('prefers the session owner over the project owner', () => {
    const target = resolveMessageTarget(
      { type: 'msg', sessionId: 's1', projectId: 'p1' } as any,
      makeResolver({
        getSessionBackendId: () => 'backend-b',
        getProjectBackendId: () => 'backend-c',
      }),
    );
    expect(target).toBe('backend-b');
  });

  it('falls back when the message carries no session or project id', () => {
    const target = resolveMessageTarget({ type: 'ping' } as any, makeResolver());
    expect(target).toBe('backend-a');
  });

  it('falls back when the owner is unknown', () => {
    const target = resolveMessageTarget(
      { type: 'rename_session', sessionId: 's1', name: 'x' } as any,
      makeResolver({ getSessionBackendId: () => null }),
    );
    expect(target).toBe('backend-a');
  });

  it('returns null when there is no owner and no fallback', () => {
    const target = resolveMessageTarget(
      { type: 'ping' } as any,
      makeResolver({ fallbackBackendId: null }),
    );
    expect(target).toBeNull();
  });

  it('ignores non-string sessionId/projectId values', () => {
    const target = resolveMessageTarget(
      { type: 'weird', sessionId: 123, projectId: null } as any,
      makeResolver({ getSessionBackendId: () => 'backend-b' }),
    );
    expect(target).toBe('backend-a');
  });
});
