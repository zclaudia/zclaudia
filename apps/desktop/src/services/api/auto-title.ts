import type { AutoTitleConfig, UpdateAutoTitleConfigRequest } from '@zclaudia/shared/core/server';
import { fetchApi } from './base';

export async function getAutoTitleConfig(): Promise<AutoTitleConfig> {
  const result = await fetchApi<AutoTitleConfig>('/api/auto-title/config');
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to get session title config');
  }
  return result.data;
}

export async function updateAutoTitleConfig(
  config: UpdateAutoTitleConfigRequest
): Promise<AutoTitleConfig> {
  const result = await fetchApi<AutoTitleConfig>('/api/auto-title/config', {
    method: 'PUT',
    body: JSON.stringify(config),
  });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to update session title config');
  }
  return result.data;
}
