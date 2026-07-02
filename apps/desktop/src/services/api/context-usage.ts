import { apiCall } from './unwrap';
import type { ContextUsagePayload } from '@zclaudia/shared';

export type SessionContextUsage =
  | { available: false }
  | ({ available: true } & ContextUsagePayload);

export async function getSessionContextUsage(sessionId: string): Promise<SessionContextUsage> {
  return apiCall<SessionContextUsage>(
    `/api/providers/sessions/${encodeURIComponent(sessionId)}/context-usage`
  );
}
