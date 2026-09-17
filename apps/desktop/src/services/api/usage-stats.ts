import { apiCallForBackend } from './unwrap';
import type {
  ModelUsagePayload,
  RuntimeUsagePayload,
  UsageStatsPayload,
  UsageStatsRange,
} from '@zclaudia/shared';

/** The device's IANA zone, shared with every backend so merged views bucket
 *  calendar days identically (runtime usage design §8). */
export function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** Local-backend usage stats for the Home page panel. */
export async function getUsageStats(
  backendId: string | null,
  range: UsageStatsRange = 'all',
  options: { asOf?: number; includeDetails?: boolean } = {}
): Promise<UsageStatsPayload> {
  const params = new URLSearchParams({ range, timeZone: localTimeZone() });
  if (options.asOf !== undefined) params.set('asOf', String(options.asOf));
  if (options.includeDetails) params.set('include', 'details');
  const suffix = `?${params}`;
  return apiCallForBackend<UsageStatsPayload>(backendId, `/api/stats/usage${suffix}`);
}

/** Local-backend per-model usage for the Models tab. */
export async function getModelStats(
  backendId: string | null,
  range: UsageStatsRange = 'all',
  options: { asOf?: number } = {}
): Promise<ModelUsagePayload> {
  const params = new URLSearchParams({ range, timeZone: localTimeZone() });
  if (options.asOf !== undefined) params.set('asOf', String(options.asOf));
  const suffix = `?${params}`;
  return apiCallForBackend<ModelUsagePayload>(backendId, `/api/stats/models${suffix}`);
}

/**
 * Ledger-backed runtime usage (Overview coverage + Runtimes tab). Every
 * backend receives the same asOf/timeZone so merged views stay consistent;
 * callers dedupe payloads by datasetId (same database, multiple connections).
 */
export async function getRuntimeUsage(
  backendId: string | null,
  range: UsageStatsRange = 'all',
  options: { timeZone?: string; asOf?: number } = {}
): Promise<RuntimeUsagePayload> {
  const params = new URLSearchParams();
  if (range !== 'all') params.set('range', range);
  const timeZone = options.timeZone ?? localTimeZone();
  if (timeZone) params.set('timeZone', timeZone);
  if (options.asOf !== undefined) params.set('asOf', String(options.asOf));
  const query = params.toString();
  return apiCallForBackend<RuntimeUsagePayload>(
    backendId,
    `/api/stats/runtime-usage${query ? `?${query}` : ''}`
  );
}
