import type { ModeTransition, ProviderRuntimeEvent } from '@zclaudia/plugin-sdk/providers';

export type CanonicalPlanTool = 'EnterPlanMode' | 'ExitPlanMode';
export type ModeTransitionAction = 'enter' | 'exit';

export function canonicalPlanToolName(toolName: unknown): CanonicalPlanTool | undefined {
  if (typeof toolName !== 'string') return undefined;
  if (toolName === 'EnterPlanMode' || toolName.endsWith('__enter_plan_mode')) {
    return 'EnterPlanMode';
  }
  if (toolName === 'ExitPlanMode' || toolName.endsWith('__exit_plan_mode')) {
    return 'ExitPlanMode';
  }
  return undefined;
}

export function planToolSemantic(toolName: unknown): 'plan_enter' | 'plan_proposal' | undefined {
  const canonical = canonicalPlanToolName(toolName);
  if (canonical === 'EnterPlanMode') return 'plan_enter';
  if (canonical === 'ExitPlanMode') return 'plan_proposal';
  return undefined;
}

export function planFromPayload(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined;
  const plan = (payload as Record<string, unknown>).plan;
  return typeof plan === 'string' ? plan : undefined;
}

export function makeModeTransition(
  action: ModeTransitionAction,
  sourceToolUseId?: string,
  plan?: string
): ModeTransition {
  return {
    mode: action === 'enter' ? 'plan' : 'default',
    reason: action,
    sourceToolUseId,
    ...(plan ? { plan } : {}),
  };
}

export function modeTransitionForPlanTool(
  toolName: unknown,
  payload: unknown,
  sourceToolUseId?: string
): ModeTransition | undefined {
  const canonical = canonicalPlanToolName(toolName);
  if (canonical === 'EnterPlanMode') return makeModeTransition('enter', sourceToolUseId);
  if (canonical === 'ExitPlanMode') {
    return makeModeTransition('exit', sourceToolUseId, planFromPayload(payload));
  }
  return undefined;
}

export function modeTransitionEvent(
  action: ModeTransitionAction,
  sourceToolUseId?: string,
  plan?: string
): ProviderRuntimeEvent {
  return {
    type: 'mode_transition',
    modeTransition: makeModeTransition(action, sourceToolUseId, plan),
  };
}
