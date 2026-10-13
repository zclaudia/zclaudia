import type { PlanReviewInteractionMessage } from '@zclaudia/shared/interaction/forms';

export interface PlanModeResult {
  ok: boolean;
  alreadyActive?: boolean;
  wasActive?: boolean;
  error?: string;
}

/** Host session transitions and human approval; tools only validate and format inputs. */
export interface PlanModePort {
  enter(sessionId: string): PlanModeResult;
  exit(sessionId: string): PlanModeResult;
  isPlanning(sessionId: string): boolean;
  review(event: PlanReviewInteractionMessage): Promise<Record<string, unknown>>;
}
