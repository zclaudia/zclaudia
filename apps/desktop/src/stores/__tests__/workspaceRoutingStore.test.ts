import { beforeEach, describe, expect, it } from 'vitest';
import {
  registerWorkspaceRoute,
  sessionWorkspaceId,
  useWorkspaceRoutingStore,
} from '../workspaceRoutingStore';

beforeEach(() => useWorkspaceRoutingStore.setState({ registrations: [], active: null }));

describe('window-local workspace routing', () => {
  it('keeps scoped keys distinct from real session ids and projects', () => {
    expect(sessionWorkspaceId('A')).not.toBe('A');
    expect(sessionWorkspaceId('A')).not.toBe(sessionWorkspaceId('B'));
    expect(sessionWorkspaceId('A')).toBe(JSON.stringify(['session-workspace', 'A']));
  });

  it('keeps the newest owner active when an earlier registration cleans up', () => {
    const a = { workspaceId: 'A', sessionId: 'A', projectId: 'p', projectScoped: true };
    const b = {
      workspaceId: sessionWorkspaceId('B'),
      sessionId: 'B',
      projectId: 'p',
      projectScoped: false,
    };
    const unregisterA = registerWorkspaceRoute(a);
    const unregisterB = registerWorkspaceRoute(b);
    unregisterA();
    expect(useWorkspaceRoutingStore.getState().active).toBe(b);
    unregisterB();
    expect(useWorkspaceRoutingStore.getState().active).toBeNull();
  });

  it('restores the earlier owner after nested scope cleanup and tolerates duplicate cleanup', () => {
    const a = { workspaceId: 'A', sessionId: 'A', projectScoped: true };
    const unregisterA = registerWorkspaceRoute(a);
    const unregisterB = registerWorkspaceRoute({
      workspaceId: 'B',
      sessionId: 'B',
      projectScoped: false,
    });
    unregisterB();
    unregisterB();
    expect(useWorkspaceRoutingStore.getState().active).toBe(a);
    unregisterA();
    expect(useWorkspaceRoutingStore.getState().registrations).toEqual([]);
  });
});
