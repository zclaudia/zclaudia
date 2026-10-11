import { beforeEach, describe, expect, it } from 'vitest';
import { useSessionsStore, type RemoteSession } from '../sessionsStore';
import { useOwnershipStore } from '../ownershipStore';

const session = (id: string): RemoteSession => ({ id, projectId: 'p', type: 'regular', createdAt: 1, updatedAt: 1, isActive: false });
const ids = () => useSessionsStore.getState().remoteSessions.get('owner')?.map(s => s.id);

beforeEach(() => useSessionsStore.getState().clearAllSessions());

describe('workspace REST creation admission', () => {
  it('keeps new chats past one in-flight snapshot and bounds the grace to one complete snapshot', () => {
    const store = useSessionsStore.getState();
    store.setRemoteSessions('owner', [session('A')]);
    store.admitCreatedSession('owner', session('B'));
    expect(ids()).toEqual(['A', 'B']);
    store.setRemoteSessions('owner', [session('A')]);
    expect(ids()).toEqual(['A', 'B']);
    expect(useOwnershipStore.getState().getSessionBackendId('B')).toBe('owner');
    store.setRemoteSessions('owner', [session('A')]);
    expect(ids()).toEqual(['A']);
    expect(useSessionsStore.getState().pendingAdmissions.has('owner')).toBe(false);
    expect(useSessionsStore.getState().deletedSessionIds.get('owner')?.has('B')).toBe(true);
  });

  it('clears admission once a snapshot confirms the chat, so a later missing snapshot removes it immediately', () => {
    const store = useSessionsStore.getState();
    store.admitCreatedSession('owner', session('B'));
    store.setRemoteSessions('owner', [session('B')]);
    expect(useSessionsStore.getState().pendingAdmissions.has('owner')).toBe(false);
    store.setRemoteSessions('owner', []);
    expect(ids()).toEqual([]);
  });

  it('honors explicit deletion immediately without applying snapshot grace', () => {
    const store = useSessionsStore.getState();
    store.admitCreatedSession('owner', session('B'));
    store.handleSessionEvent('owner', 'deleted', session('B'));
    expect(ids()).toEqual([]);
    expect(useSessionsStore.getState().pendingAdmissions.has('owner')).toBe(false);
    store.setRemoteSessions('owner', []);
    expect(ids()).toEqual([]);
  });

  it('keeps REST admission after a live created/upsert event until a full snapshot confirms it', () => {
    const store = useSessionsStore.getState();
    store.setRemoteSessions('owner', [session('A')]);
    store.admitCreatedSession('owner', session('B'));
    store.handleSessionEvent('owner', 'created', { ...session('B'), name: 'live-created' });
    store.handleSessionEvent('owner', 'updated', { ...session('B'), name: 'live-updated' });
    expect(useSessionsStore.getState().pendingAdmissions.get('owner')?.has('B')).toBe(true);
    store.setRemoteSessions('owner', [session('A')]);
    expect(ids()).toEqual(['A', 'B']);
    expect(useSessionsStore.getState().remoteSessions.get('owner')?.find(s => s.id === 'B')?.name).toBe('live-updated');
    store.setRemoteSessions('owner', [session('A'), session('B')]);
    expect(useSessionsStore.getState().pendingAdmissions.has('owner')).toBe(false);
  });

  it('keeps an explicit deletion authoritative over the first late full snapshot containing the deleted chat', () => {
    const store = useSessionsStore.getState();
    store.setRemoteSessions('owner', [session('A'), session('B')]);
    store.handleSessionEvent('owner', 'deleted', session('B'));
    store.setRemoteSessions('owner', [session('A'), session('B')]);
    expect(ids()).toEqual(['A']);
    expect(useSessionsStore.getState().deletedSessionIds.get('owner')?.has('B')).toBe(true);
    // A second positive full snapshot is bounded confirmation of revival.
    store.setRemoteSessions('owner', [session('A'), session('B')]);
    expect(ids()).toEqual(['A', 'B']);
    expect(useSessionsStore.getState().deletedSessionIds.get('owner')?.has('B')).toBe(false);
  });

  it('permits an actual positive live creation to revoke a deletion tombstone immediately', () => {
    const store = useSessionsStore.getState();
    store.setRemoteSessions('owner', [session('B')]);
    store.handleSessionEvent('owner', 'deleted', session('B'));
    store.handleSessionEvent('owner', 'created', session('B'));
    expect(ids()).toEqual(['B']);
    expect(useSessionsStore.getState().deletedSessionIds.get('owner')?.has('B')).toBe(false);
  });

  it('does not treat creation/loading/incremental events as complete snapshots', () => {
    const store = useSessionsStore.getState();
    store.admitCreatedSession('owner', session('B'));
    expect(useSessionsStore.getState().snapshotBackendIds.has('owner')).toBe(false);
    expect(useSessionsStore.getState().snapshotGenerations.has('owner')).toBe(false);
    store.handleSessionEvent('owner', 'created', session('B'));
    expect(useSessionsStore.getState().pendingAdmissions.get('owner')?.has('B')).toBe(true);
    expect(useSessionsStore.getState().snapshotGenerations.has('owner')).toBe(false);
    store.setRemoteSessions('owner', [session('B')]);
    const generation = useSessionsStore.getState().snapshotGenerations.get('owner');
    store.handleSessionEvent('owner', 'updated', { ...session('B'), name: 'updated' });
    expect(useSessionsStore.getState().snapshotGenerations.get('owner')).toBe(generation);
  });

  it('clears only a removed backend’s transient markers and keeps other backends intact', () => {
    const store = useSessionsStore.getState();
    store.setRemoteSessions('owner', [session('A')]);
    store.admitCreatedSession('owner', session('B'));
    store.setRemoteSessions('other', [session('C')]);
    store.clearBackendSessions('owner');
    expect(useSessionsStore.getState().snapshotGenerations.has('owner')).toBe(false);
    expect(useSessionsStore.getState().pendingAdmissions.has('owner')).toBe(false);
    expect(useSessionsStore.getState().deletedSessionIds.has('owner')).toBe(false);
    expect(useSessionsStore.getState().remoteSessions.get('other')).toEqual([session('C')]);
  });
});
