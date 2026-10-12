import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAgentProfileMetaStore } from '../agentProfileMetaStore';
import { useServerStore } from '../serverStore';
import { listAgentProfiles } from '../../services/api/agent-profiles';

vi.mock('../../services/api/agent-profiles', () => ({ listAgentProfiles: vi.fn() }));

describe('agentProfileMetaStore backend identity', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    useAgentProfileMetaStore.setState({
      profiles: {},
      loaded: false,
      loading: false,
      backendId: null,
    });
    useServerStore.setState({ activeServerId: 'A' });
  });

  it('does not relabel A profiles as B when B fails to load', async () => {
    useAgentProfileMetaStore.getState().setAll([{ id: 'same-id', name: 'A agent' }] as any);
    useServerStore.setState({ activeServerId: 'B' });
    vi.mocked(listAgentProfiles).mockRejectedValue(new Error('offline'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    await useAgentProfileMetaStore.getState().loadAll();
    expect(useAgentProfileMetaStore.getState().backendId).toBe('B');
    expect(useAgentProfileMetaStore.getState().profiles).toEqual({});
    log.mockRestore();
  });

  it.each(['success', 'failure'] as const)(
    'ignores old A %s when active backend changed to B',
    async completion => {
      useAgentProfileMetaStore.getState().setAll([{ id: 'same-id', name: 'A agent' }] as any);
      let resolve!: (profiles: any[]) => void;
      let reject!: (error: Error) => void;
      vi.mocked(listAgentProfiles).mockReturnValue(
        new Promise((done, fail) => {
          resolve = done;
          reject = fail;
        })
      );
      const request = useAgentProfileMetaStore.getState().loadAll();
      useServerStore.setState({ activeServerId: 'B' });
      useAgentProfileMetaStore.getState().setAll([{ id: 'same-id', name: 'B agent' }] as any);
      const log = vi.spyOn(console, 'error').mockImplementation(() => {});
      if (completion === 'success') resolve([{ id: 'same-id', name: 'Late A' }]);
      else reject(new Error('offline'));
      await request;
      expect(useAgentProfileMetaStore.getState().backendId).toBe('B');
      expect(useAgentProfileMetaStore.getState().getById('same-id')?.name).toBe('B agent');
      expect(useAgentProfileMetaStore.getState().loading).toBe(false);
      log.mockRestore();
    }
  );
});
