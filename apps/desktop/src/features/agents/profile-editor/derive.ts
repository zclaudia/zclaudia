// Pure derivation helpers for the agent profile editor: model-capability lookups,
// tool-set selection analysis, and display labels. No React, no state.
import type {
  LlmProfileConfig,
  McpServerConfig,
  SkillRef,
  ToolName,
  ToolSelection,
} from '@zclaudia/shared';
import { BUILTIN_TOOL_SETS } from '@zclaudia/shared';
import type { ProfileConfigDescriptor } from '@zclaudia/shared/core/profile-config-descriptor';
import type { WorkspaceSkillInfo } from '../../../services/api';

export type BuiltinToolSetId = keyof typeof BUILTIN_TOOL_SETS;

export const EDITABLE_BUILTIN_TOOL_SET_IDS = (
  Object.keys(BUILTIN_TOOL_SETS) as BuiltinToolSetId[]
).filter(setId => setId !== 'all-builtin');

export type LlmProfileModelEntry = NonNullable<LlmProfileConfig['models']>[number];

/** First few tool names of a set, as a one-line hint under/next to its label. */
export function toolSetPreview(tools: readonly string[]): string {
  return tools.slice(0, 4).join(', ') + (tools.length > 4 ? '...' : '');
}

/** Fallback descriptor for a runtime the active backend does not currently provide
 *  (e.g. its plugin is not installed/active). Keeps the editor renderable instead of crashing. */
export function unavailableDescriptor(runtime: string): ProfileConfigDescriptor {
  return {
    runtime,
    label: runtime,
    enabled: false,
    model: { kind: 'none', multimodalFallback: false, thinkingLevel: 'off' },
    hasCliPath: false,
    capabilities: { tools: 'unsupported', providers: 'unsupported', skills: 'unsupported' },
    authNote: `Runtime "${runtime}" is not available on this backend. Enable the plugin that provides it.`,
  };
}

export function modelSupportsVision(entry: LlmProfileModelEntry): boolean {
  return entry.inputModalities?.includes('image') ?? false;
}

export function visionCapableModels(profile: LlmProfileConfig | undefined): LlmProfileModelEntry[] {
  return (profile?.models ?? []).filter(modelSupportsVision);
}

export function fallbackModelValidForProfile(
  model: string,
  profile: LlmProfileConfig | undefined
): boolean {
  const trimmed = model.trim();
  if (!trimmed) return false;
  const models = profile?.models;
  if (!models || models.length === 0) return true;
  return models.some(entry => entry.modelId === trimmed && modelSupportsVision(entry));
}

export function isBuiltinRefForTools(
  ref: ToolSelection['include'][number],
  tools: readonly ToolName[]
): boolean {
  return ref.source === 'builtin' && tools.includes(ref.name);
}

export function removeBuiltinRefsForTools(
  refs: ToolSelection['include'],
  tools: readonly ToolName[]
): ToolSelection['include'] {
  return refs.filter(ref => !isBuiltinRefForTools(ref, tools));
}

export function deriveCustomizedToolSetIds(selection: ToolSelection): BuiltinToolSetId[] {
  return EDITABLE_BUILTIN_TOOL_SET_IDS.filter(setId => {
    const set = BUILTIN_TOOL_SETS[setId];
    const hasFullSet = selection.sets.some(
      selected => selected.source === 'builtin' && selected.id === setId
    );
    if (hasFullSet) return false;
    return (
      selection.include.some(ref => isBuiltinRefForTools(ref, set.tools)) ||
      selection.exclude.some(ref => isBuiltinRefForTools(ref, set.tools))
    );
  });
}

export function externalProviderLabel(
  provider: NonNullable<ToolSelection['providers']>[number]
): string {
  if (provider.source === 'mcp') return `mcp/${provider.serverId}`;
  return provider.providerId
    ? `plugin/${provider.pluginId}/${provider.providerId}`
    : `plugin/${provider.pluginId}`;
}

export function externalToolRefLabel(ref: ToolSelection['include'][number]): string | undefined {
  if (ref.source === 'mcp') return `mcp/${ref.server}/${ref.tool}`;
  if (ref.source === 'plugin') return `plugin/${ref.pluginId}/${ref.toolId}`;
  return undefined;
}

export function formatPinnedExternalToolCount(count: number): string {
  return `${count} pinned external ${count === 1 ? 'tool' : 'tools'}`;
}

export function mcpTrustSummaryLabels(server: McpServerConfig): string[] {
  const policy = server.trustPolicy;
  const labels = [
    `trust ${policy?.trustLevel ?? 'untrusted'}`,
    `default ${policy?.defaultRiskAction ?? 'ask'}`,
    `readonly hints ${policy?.trustReadOnlyHint ? 'trusted' : 'untrusted'}`,
  ];
  for (const level of ['low', 'medium', 'high'] as const) {
    const action = policy?.riskActions?.[level];
    if (action) labels.push(`${level} ${action}`);
  }
  return labels;
}

export function skillRefFor(skill: WorkspaceSkillInfo): SkillRef {
  return {
    source: skill.source ?? 'workspace',
    id: skill.id,
  };
}
