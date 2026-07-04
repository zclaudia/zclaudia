import { apiCallForBackend } from './unwrap';
import type { ModelUsagePayload, UsageStatsPayload, UsageStatsRange } from '@zclaudia/shared';

/** Local-backend usage stats for the Home page panel. */
export async function getUsageStats(
  backendId: string | null,
  range: UsageStatsRange = 'all'
): Promise<UsageStatsPayload> {
  const suffix = range === 'all' ? '' : `?range=${range}`;
  return apiCallForBackend<UsageStatsPayload>(backendId, `/api/stats/usage${suffix}`);
}

/** Local-backend per-model usage for the Models tab. */
export async function getModelStats(
  backendId: string | null,
  range: UsageStatsRange = 'all'
): Promise<ModelUsagePayload> {
  const suffix = range === 'all' ? '' : `?range=${range}`;
  return apiCallForBackend<ModelUsagePayload>(backendId, `/api/stats/models${suffix}`);
}
