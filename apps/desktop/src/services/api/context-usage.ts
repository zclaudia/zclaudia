import { apiCall } from './unwrap';
import type { ContextUsagePayload } from '@zclaudia/shared';

export type SessionContextUsage =
  /**
   * `supported: false` means the session's runtime never reports a breakdown
   * (external CLI runtimes); missing/`true` means "no run yet". Older servers
   * omit the field, so treat `undefined` as supported.
   */
  | { available: false; supported?: boolean }
  | ({ available: true } & ContextUsagePayload);

export async function getSessionContextUsage(sessionId: string): Promise<SessionContextUsage> {
  return apiCall<SessionContextUsage>(
    `/api/providers/sessions/${encodeURIComponent(sessionId)}/context-usage`
  );
}
