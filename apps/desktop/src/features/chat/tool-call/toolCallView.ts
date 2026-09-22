import type { ToolEffect } from '@zclaudia/shared';
import type { ToolCallView } from '@zclaudia/agent-transcript-kit';
import type { ToolCallState } from '../../../stores/runStore';

/**
 * Host shape → kit shape, at the boundary where rendering begins.
 *
 * Tool calls reach the transcript from two places with the same host shape:
 * the live run (runStore, itself kit-backed) and persisted history
 * (`message.toolCalls`). Renderers speak only the kit's ToolCallView, so both
 * sources funnel through here rather than each renderer learning the store's
 * field names.
 *
 * ToolEffect and the backgroundable affordance are zclaudia-specific (the kit
 * has no slot for them), so they ride the open `ext` slot the kit provides
 * for exactly this.
 */
export interface ToolCallViewExt {
  effect?: ToolEffect;
  /** Runtime can move this running call to a background task on request. */
  backgroundable?: boolean;
}

export function toToolCallView(toolCall: ToolCallState): ToolCallView {
  return {
    id: toolCall.id,
    name: toolCall.toolName,
    input: toolCall.toolInput,
    // `isError` is a separate field host-side and outranks `status`: the live
    // store keeps the two in step, but persisted history can carry
    // `completed` + `isError`, which the kit expresses as `error`.
    status: toolCall.isError
      ? 'error'
      : toolCall.status === 'completed'
        ? 'success'
        : toolCall.status,
    result: toolCall.result,
    semantic: toolCall.semantic,
    summary: toolCall.activity,
    ...(toolCall.effect || toolCall.backgroundable
      ? {
          ext: {
            ...(toolCall.effect ? { effect: toolCall.effect } : {}),
            ...(toolCall.backgroundable ? { backgroundable: true } : {}),
          } satisfies ToolCallViewExt,
        }
      : {}),
  };
}

/** Read the host-specific ToolEffect back out of a kit tool call. */
export function toolCallEffect(toolCall: ToolCallView): ToolEffect | undefined {
  return (toolCall.ext as ToolCallViewExt | undefined)?.effect;
}
