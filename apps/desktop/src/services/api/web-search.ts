import type { UpdateWebSearchConfigRequest, WebSearchConfig } from '@zclaudia/shared';
import { fetchApi } from './base';

export async function getWebSearchConfig(): Promise<WebSearchConfig> {
  const result = await fetchApi<WebSearchConfig>('/api/web-search/config');
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to get Web Search config');
  }
  return result.data;
}

export async function updateWebSearchConfig(
  config: UpdateWebSearchConfigRequest
): Promise<WebSearchConfig> {
  const result = await fetchApi<WebSearchConfig>('/api/web-search/config', {
    method: 'PUT',
    body: JSON.stringify(config),
  });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to update Web Search config');
  }
  return result.data;
}
