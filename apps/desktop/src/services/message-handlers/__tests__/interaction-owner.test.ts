import { beforeEach, describe, expect, it } from 'vitest';
import { resolveOwnerBackendId } from '../interaction-owner';
import { useFacadeStore } from '../../../stores/facadeStore';

describe('resolveOwnerBackendId', () => {
  beforeEach(() => {
    useFacadeStore.setState({ localBackendId: null, backends: [] });
  });

  it('uses the routed backend ID for gateway traffic', () => {
    expect(resolveOwnerBackendId('remote-1', 'gw:remote-1')).toBe('remote-1');
  });

  it('resolves a legacy local server ID to the current local backend', () => {
    useFacadeStore.setState({ localBackendId: 'local-instance' });

    expect(resolveOwnerBackendId(null, 'local')).toBe('local-instance');
  });

  it('preserves an ordinary backend ID', () => {
    expect(resolveOwnerBackendId('remote-2', 'remote-2')).toBe('remote-2');
  });
});
