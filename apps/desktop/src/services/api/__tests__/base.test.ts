import { describe, it, expect, beforeEach } from 'vitest';
import type { ServerFeature } from '@zclaudia/shared';
import { backendSupports } from '../base';
import { useServerStore } from '../../../stores/serverStore';
import { useFacadeStore } from '../../../stores/facadeStore';

function setFeatures(serverId: string, features: ServerFeature[]) {
  useServerStore.setState(state => ({
    connections: {
      ...state.connections,
      [serverId]: { isLocalConnection: null, features },
    },
  }));
}

describe('backendSupports', () => {
  beforeEach(() => {
    useServerStore.setState({ activeServerId: null, connections: {} });
    useFacadeStore.setState({ localBackendId: null, backends: [] });
  });

  it('returns true when the backend advertises the feature', () => {
    setFeatures('backend-1', ['setDefaultProvider']);
    expect(backendSupports('backend-1', 'setDefaultProvider')).toBe(true);
  });

  it('returns false for an unknown backend id', () => {
    setFeatures('backend-1', ['setDefaultProvider']);
    expect(backendSupports('backend-2', 'setDefaultProvider')).toBe(false);
  });

  it('returns false when the backend has an empty feature list', () => {
    setFeatures('backend-1', []);
    expect(backendSupports('backend-1', 'setDefaultProvider')).toBe(false);
  });

  it('falls back to the active server when backendId is null', () => {
    useServerStore.setState({ activeServerId: 'backend-1' });
    setFeatures('backend-1', ['setDefaultProvider']);
    expect(backendSupports(null, 'setDefaultProvider')).toBe(true);
  });

  it('returns false when backendId is null and there is no active server', () => {
    expect(backendSupports(null, 'setDefaultProvider')).toBe(false);
  });

  it("resolves the legacy 'local' id to the real local backend id", () => {
    useFacadeStore.setState({ localBackendId: 'real-local-id' });
    setFeatures('real-local-id', ['setDefaultProvider']);
    expect(backendSupports('local', 'setDefaultProvider')).toBe(true);
  });
});
