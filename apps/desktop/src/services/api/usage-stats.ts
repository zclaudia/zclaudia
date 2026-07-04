import { apiCallForBackend } from './unwrap';
import type { UsageStatsPayload, UsageStatsRange } from '@zclaudia/shared';

/** Local-backend usage stats for the Home page panel. */
export async function getUsageStats(
  backendId: string | null,
  range: UsageStatsRange = 'all'
): Promise<UsageStatsPayload> {
  const suffix = range === 'all' ? '' : `?range=${range}`;
  return apiCallForBackend<UsageStatsPayload>(backendId, `/api/stats/usage${suffix}`);
}
