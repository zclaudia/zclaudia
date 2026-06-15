import { describe, it, expect } from 'vitest';
import { computeConnectionPlan } from '../backendConnectionLifecycle';

const none = () => false;

describe('computeConnectionPlan', () => {
  it('connects a newly-expanded remote backend', () => {
    const plan = computeConnectionPlan({
      expandedBackendIds: ['remote-1'],
      foregroundBackendId: 'local',
      localBackendId: 'local',
      managedBackendIds: [],
      isConnected: none,
    });
    expect(plan.toConnect).toEqual(['remote-1']);
    expect(plan.toDisconnect).toEqual([]);
    expect(plan.nextManaged).toEqual(['remote-1']);
  });

  it('never connects or manages the local backend', () => {
    const plan = computeConnectionPlan({
      expandedBackendIds: ['local'],
      foregroundBackendId: 'local',
      localBackendId: 'local',
      managedBackendIds: [],
      isConnected: none,
    });
    expect(plan.toConnect).toEqual([]);
    expect(plan.nextManaged).toEqual([]);
  });

  it('disconnects a collapsed remote backend it had managed', () => {
    const plan = computeConnectionPlan({
      expandedBackendIds: [],
      foregroundBackendId: 'local',
      localBackendId: 'local',
      managedBackendIds: ['remote-1'],
      isConnected: () => true,
    });
    expect(plan.toDisconnect).toEqual(['remote-1']);
    expect(plan.nextManaged).toEqual([]);
  });

  it('keeps the foreground remote backend connected even when collapsed (pin)', () => {
    const plan = computeConnectionPlan({
      expandedBackendIds: [],
      foregroundBackendId: 'remote-1',
      localBackendId: 'local',
      managedBackendIds: ['remote-1'],
      isConnected: () => true,
    });
    expect(plan.toDisconnect).toEqual([]);
    expect(plan.nextManaged).toEqual(['remote-1']);
  });

  it('does not reconnect a backend it already manages', () => {
    const plan = computeConnectionPlan({
      expandedBackendIds: ['remote-1'],
      foregroundBackendId: 'local',
      localBackendId: 'local',
      managedBackendIds: ['remote-1'],
      isConnected: () => true,
    });
    expect(plan.toConnect).toEqual([]);
    expect(plan.nextManaged).toEqual(['remote-1']);
  });

  it('does not connect an expanded remote backend that is already connected externally', () => {
    const plan = computeConnectionPlan({
      expandedBackendIds: ['remote-1'],
      foregroundBackendId: 'local',
      localBackendId: 'local',
      managedBackendIds: [],
      isConnected: (id) => id === 'remote-1',
    });
    expect(plan.toConnect).toEqual([]);
    expect(plan.nextManaged).toEqual([]);
  });

  it('handles a null foreground', () => {
    const plan = computeConnectionPlan({
      expandedBackendIds: ['remote-1'],
      foregroundBackendId: null,
      localBackendId: 'local',
      managedBackendIds: [],
      isConnected: none,
    });
    expect(plan.toConnect).toEqual(['remote-1']);
  });
});
