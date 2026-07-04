import { apiCallForBackend } from './unwrap';
import type { UsageStatsPayload } from '@zclaudia/shared';

/** Local-backend usage stats for the Home page strip. */
export async function getUsageStats(backendId: string | null): Promise<UsageStatsPayload> {
  return apiCallForBackend<UsageStatsPayload>(backendId, '/api/stats/usage');
}
