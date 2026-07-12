import type { ProfileConfigDescriptor } from '@zclaudia/shared/core/profile-config-descriptor';
import { apiCall } from './unwrap';
import { useRuntimeDescriptorStore } from '../../stores/runtimeDescriptorStore';

/**
 * Fetch the active backend's agent-runtime descriptors and sync to the store.
 * `apiCall` unwraps the `{ success, data }` envelope, so this returns the array directly.
 */
export async function fetchAndSyncRuntimeDescriptors(options?: RequestInit): Promise<void> {
  const descriptors = await apiCall<ProfileConfigDescriptor[]>('/api/agent-runtimes', options);
  useRuntimeDescriptorStore.getState().setDescriptors(descriptors);
}
