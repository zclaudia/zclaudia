import type { Goal } from '@zclaudia/shared';
import { apiCallForBackend } from './unwrap';
import { resolveSessionOwnerBackendId } from '../../utils/sessionOwnership';

export interface SetGoalRequest {
  objective: string;
  tokenBudget?: number;
  maxTurns?: number;
}

export async function getGoal(sessionId: string): Promise<Goal | null> {
  return apiCallForBackend<Goal | null>(
    resolveSessionOwnerBackendId(sessionId),
    `/api/sessions/${sessionId}/goal`
  );
}

export async function setGoal(sessionId: string, body: SetGoalRequest): Promise<Goal> {
  return apiCallForBackend<Goal>(
    resolveSessionOwnerBackendId(sessionId),
    `/api/sessions/${sessionId}/goal`,
    {
      method: 'PUT',
      body: JSON.stringify(body),
    }
  );
}

export async function pauseGoal(sessionId: string): Promise<Goal> {
  return apiCallForBackend<Goal>(
    resolveSessionOwnerBackendId(sessionId),
    `/api/sessions/${sessionId}/goal/pause`,
    { method: 'POST' }
  );
}

export async function resumeGoal(sessionId: string): Promise<Goal> {
  return apiCallForBackend<Goal>(
    resolveSessionOwnerBackendId(sessionId),
    `/api/sessions/${sessionId}/goal/resume`,
    { method: 'POST' }
  );
}

export async function clearGoal(sessionId: string): Promise<Goal> {
  return apiCallForBackend<Goal>(
    resolveSessionOwnerBackendId(sessionId),
    `/api/sessions/${sessionId}/goal`,
    { method: 'DELETE' }
  );
}
