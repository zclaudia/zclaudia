import type { AgentRuntimeType } from './agent-profile.js';

export type ModelConfigKind = 'llm-profile' | 'native' | 'none';

/**
 * How a capability area is surfaced for a runtime.
 * - 'profile'         : editable in the profile and injected
 * - 'external'        : managed elsewhere (e.g. ~/.claude), shown read-only
 * - 'native-readonly' : runtime-native; built-ins are NOT injected — read-only note only
 * - 'unsupported'     : not applicable — hidden
 */
export type CapabilityMode = 'profile' | 'external' | 'native-readonly' | 'unsupported';

export interface ProfileConfigDescriptor {
  runtime: AgentRuntimeType;
  /** Display name in the Runtime selector. */
  label: string;
  /** Whether this runtime appears in the Runtime selector yet. */
  enabled: boolean;
  model: {
    kind: ModelConfigKind;
    multimodalFallback: boolean;
    thinkingLevel: boolean;
  };
  capabilities: {
    tools: CapabilityMode;
    providers: CapabilityMode;
    skills: CapabilityMode;
  };
  /** Optional banner shown under the Model section. */
  authNote?: string;
}

export const PROFILE_CONFIG_DESCRIPTORS: Record<string, ProfileConfigDescriptor> = {
  zclaudia: {
    runtime: 'zclaudia',
    label: 'ZClaudia',
    enabled: true,
    model: { kind: 'llm-profile', multimodalFallback: true, thinkingLevel: true },
    capabilities: { tools: 'profile', providers: 'profile', skills: 'profile' },
  },
};

export function getProfileConfigDescriptor(
  runtime: AgentRuntimeType | undefined
): ProfileConfigDescriptor {
  return PROFILE_CONFIG_DESCRIPTORS[runtime ?? 'zclaudia'] ?? PROFILE_CONFIG_DESCRIPTORS.zclaudia;
}

export function enabledRuntimeDescriptors(): ProfileConfigDescriptor[] {
  return Object.values(PROFILE_CONFIG_DESCRIPTORS).filter(d => d.enabled);
}

export function runtimeRequiresLlmProfile(runtime: AgentRuntimeType | undefined): boolean {
  return getProfileConfigDescriptor(runtime).model.kind === 'llm-profile';
}
