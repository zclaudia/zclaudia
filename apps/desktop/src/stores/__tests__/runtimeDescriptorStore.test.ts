import { describe, it, expect, beforeEach } from 'vitest';
import type { ProfileConfigDescriptor } from '@zclaudia/shared/core/profile-config-descriptor';
import { useRuntimeDescriptorStore } from '../runtimeDescriptorStore';

const claude: ProfileConfigDescriptor = {
  runtime: 'claude',
  label: 'Claude',
  enabled: true,
  model: { kind: 'none', multimodalFallback: false, thinkingLevel: 'auto' },
  hasCliPath: true,
  capabilities: { tools: 'native-readonly', providers: 'external', skills: 'external' },
};

describe('runtimeDescriptorStore', () => {
  beforeEach(() => useRuntimeDescriptorStore.setState({ byBackend: {} }));

  it('stores and reads descriptors per backend', () => {
    useRuntimeDescriptorStore.getState().setDescriptors([claude], 'srv1');
    expect(useRuntimeDescriptorStore.getState().getDescriptors('srv1')).toEqual([claude]);
  });

  it('returns an empty array for a backend with no descriptors', () => {
    useRuntimeDescriptorStore.getState().setDescriptors([claude], 'srv1');
    expect(useRuntimeDescriptorStore.getState().getDescriptors('other')).toEqual([]);
  });

  it('keeps backends isolated from each other', () => {
    useRuntimeDescriptorStore.getState().setDescriptors([claude], 'srv1');
    useRuntimeDescriptorStore.getState().setDescriptors([], 'srv2');
    expect(useRuntimeDescriptorStore.getState().getDescriptors('srv1')).toHaveLength(1);
    expect(useRuntimeDescriptorStore.getState().getDescriptors('srv2')).toHaveLength(0);
  });

  it('returns the same EMPTY reference when unresolved (no active server)', () => {
    const a = useRuntimeDescriptorStore.getState().getDescriptors(null);
    const b = useRuntimeDescriptorStore.getState().getDescriptors(null);
    expect(a).toBe(b);
    expect(a).toEqual([]);
  });
});
