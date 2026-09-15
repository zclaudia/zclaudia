import {
  DEFAULT_AGENT_RUNTIME,
  PI_AGENT_RUNTIME,
  normalizeAgentRuntimeType,
  type AgentRuntimeType,
} from './agent-profile.js';
import { builtinAgentPluginForRuntime } from '../plugins/builtin-agents.js';

export type ModelConfigKind = 'llm-profile' | 'native' | 'none';

/**
 * How a capability area is surfaced for a runtime.
 * - 'profile'         : editable in the profile and injected
 * - 'external'        : managed elsewhere (e.g. ~/.claude), shown read-only
 * - 'native-readonly' : runtime-native; built-ins are NOT injected — read-only note only
 * - 'unsupported'     : not applicable — hidden
 */
export type CapabilityMode = 'profile' | 'external' | 'native-readonly' | 'unsupported';

/**
 * How a runtime surfaces thinking-level control:
 * - 'off'        : no thinking level concept — the row is hidden
 * - 'auto'        : the runtime always decides — shown as a static "Auto" row
 * - 'selectable' : the profile can pick a level — shown as an interactive selector
 */
export type ThinkingLevelMode = 'off' | 'auto' | 'selectable';

export interface ProfileConfigDescriptor {
  runtime: AgentRuntimeType;
  /** Display name in the Runtime selector. */
  label: string;
  /** Whether this runtime appears in the Runtime selector yet. */
  enabled: boolean;
  model: {
    kind: ModelConfigKind;
    multimodalFallback: boolean;
    thinkingLevel: ThinkingLevelMode;
  };
  /** Whether the profile editor surfaces a CLI Path field for this runtime. */
  hasCliPath: boolean;
  capabilities: {
    tools: CapabilityMode;
    providers: CapabilityMode;
    skills: CapabilityMode;
  };
  /** Optional banner shown under the Model section. */
  authNote?: string;
  /**
   * Dual-mode runtimes: the declared engine modes with per-mode projections.
   * Absent for legacy single-mode runtimes whose top-level fields are canonical.
   */
  defaultEngineMode?: string;
  engineModes?: EngineModeSummary[];
}

/** One declared engine mode, served by /api/agent-runtimes for the editor UI. */
export interface EngineModeSummary {
  id: string;
  label: string;
  /** Projection onto the legacy descriptor fields for this mode. */
  descriptor: Omit<
    ProfileConfigDescriptor,
    'runtime' | 'label' | 'enabled' | 'defaultEngineMode' | 'engineModes'
  >;
  connection: EngineModeDescriptor['connection'];
  executable: EngineModeDescriptor['executable'];
  authNote?: string;
}

export const PROFILE_CONFIG_DESCRIPTORS: Record<string, ProfileConfigDescriptor> = {
  [PI_AGENT_RUNTIME]: {
    runtime: PI_AGENT_RUNTIME,
    label: 'Pi',
    enabled: true,
    model: { kind: 'llm-profile', multimodalFallback: true, thinkingLevel: 'selectable' },
    hasCliPath: false,
    capabilities: { tools: 'profile', providers: 'profile', skills: 'profile' },
  },
};

export function getProfileConfigDescriptor(
  runtime: AgentRuntimeType | undefined
): ProfileConfigDescriptor {
  return (
    PROFILE_CONFIG_DESCRIPTORS[normalizeAgentRuntimeType(runtime)] ??
    PROFILE_CONFIG_DESCRIPTORS[DEFAULT_AGENT_RUNTIME]
  );
}

export function enabledRuntimeDescriptors(): ProfileConfigDescriptor[] {
  return Object.values(PROFILE_CONFIG_DESCRIPTORS).filter(d => d.enabled);
}

export function runtimeRequiresLlmProfile(runtime: AgentRuntimeType | undefined): boolean {
  if (runtime && builtinAgentPluginForRuntime(runtime)) return false;
  return getProfileConfigDescriptor(runtime).model.kind === 'llm-profile';
}

// ── Engine modes (dual-mode runtimes) ────────────────────────────────────────

/**
 * Engine modes re-exported from the public plugin contract. Declared on a
 * runtime descriptor (`engineModes`); `connection` and `executable` are the
 * canonical fields from which the legacy UI fields derive.
 */
export type {
  EngineModeConnection,
  EngineModeDescriptor,
  EngineModeExecutable,
  RuntimeModelProtocol,
} from '@zclaudia/plugin-sdk/providers';

import type { EngineModeDescriptor, RuntimeModelProtocol } from '@zclaudia/plugin-sdk/providers';

/** The default engine mode used when a descriptor declares modes but no explicit default. */
export const DEFAULT_ENGINE_MODE = 'cli';

/**
 * Structural subset of a runtime descriptor the projection needs. Accepts both
 * the plugin-contribution shape and the persisted registry shape.
 */
export interface EngineModeSourceDescriptor {
  label: string;
  model: { kind: ModelConfigKind; multimodalFallback: boolean; thinkingLevel: ThinkingLevelMode };
  hasCliPath: boolean;
  capabilities: { tools: CapabilityMode; providers: CapabilityMode; skills: CapabilityMode };
  authNote?: string;
  defaultEngineMode?: string;
  engineModes?: (EngineModeDescriptor | EngineModeSummary)[];
}

/** Result of resolving an engine mode against a descriptor. */
export type ResolvedEngineMode =
  | { ok: true; engineMode: string; descriptor: ProfileConfigDescriptor }
  | { ok: false; code: 'ENGINE_MODE_UNSUPPORTED'; message: string };

/** Project either the raw declaration or the served summary onto UI fields. */
function projectModeSource(
  mode: EngineModeDescriptor | EngineModeSummary,
  runtime: AgentRuntimeType,
  label: string
): ProfileConfigDescriptor {
  if ('descriptor' in mode) {
    return { runtime, label, enabled: true, ...mode.descriptor };
  }
  return projectEngineMode(mode, runtime, label);
}

/** Derive the legacy UI fields from one mode's canonical declaration. */
export function projectEngineMode(
  mode: EngineModeDescriptor,
  runtime: AgentRuntimeType,
  label: string
): ProfileConfigDescriptor {
  const modelKind: ModelConfigKind =
    mode.connection.kind === 'llm-profile'
      ? 'llm-profile'
      : mode.connection.modelSelection === 'hidden'
        ? 'none'
        : 'native';
  return {
    runtime,
    label,
    enabled: true,
    model: {
      kind: modelKind,
      multimodalFallback: mode.modelOptions.multimodalFallback,
      thinkingLevel: mode.modelOptions.thinkingLevel,
    },
    hasCliPath: mode.executable === 'external-cli',
    capabilities: {
      tools: mode.capabilities.tools,
      providers: mode.connection.kind === 'llm-profile' ? 'profile' : 'external',
      skills: mode.capabilities.skills,
    },
    authNote: mode.authNote,
  };
}

/**
 * Pure projection of a runtime descriptor for one engine mode.
 *
 * - Descriptor without `engineModes`: legacy top-level fields stay canonical and
 *   are returned unchanged (the requested mode must be absent/null).
 * - Descriptor with `engineModes`: the top-level fields are ignored and the
 *   requested (or default) mode's projection is returned. An unknown mode is an
 *   error, never a silent fallback to another mode.
 */
export function resolveProfileConfigDescriptor(
  descriptor: EngineModeSourceDescriptor,
  runtime: AgentRuntimeType,
  engineMode?: string | null
): ResolvedEngineMode {
  if (!descriptor.engineModes || descriptor.engineModes.length === 0) {
    if (engineMode) {
      return {
        ok: false,
        code: 'ENGINE_MODE_UNSUPPORTED',
        message: `Runtime "${runtime}" does not declare engine modes; got "${engineMode}"`,
      };
    }
    return {
      ok: true,
      engineMode: '',
      descriptor: {
        runtime,
        label: descriptor.label,
        enabled: true,
        model: descriptor.model,
        hasCliPath: descriptor.hasCliPath,
        capabilities: descriptor.capabilities,
        authNote: descriptor.authNote,
      },
    };
  }

  const requested = engineMode?.trim() || descriptor.defaultEngineMode || DEFAULT_ENGINE_MODE;
  const mode = descriptor.engineModes.find(candidate => candidate.id === requested);
  if (!mode) {
    const declared = descriptor.engineModes.map(candidate => candidate.id).join(', ');
    return {
      ok: false,
      code: 'ENGINE_MODE_UNSUPPORTED',
      message: `Unknown engine mode "${requested}" for runtime "${runtime}" (declared: ${declared})`,
    };
  }
  return {
    ok: true,
    engineMode: mode.id,
    descriptor: projectModeSource(mode, runtime, descriptor.label),
  };
}

/** The engine mode a descriptor uses when none is specified (null when it declares none). */
export function defaultEngineModeFor(
  descriptor: Pick<EngineModeSourceDescriptor, 'engineModes' | 'defaultEngineMode'>
): string | null {
  if (!descriptor.engineModes || descriptor.engineModes.length === 0) return null;
  return descriptor.defaultEngineMode || DEFAULT_ENGINE_MODE;
}

/** Preferred authNote for a resolved mode: the projection's own note. */
export function engineModeAuthNote(summary: EngineModeSummary): string | undefined {
  return summary.authNote ?? summary.descriptor.authNote;
}

/**
 * Whether a resolved profile configuration requires a bound LLM profile.
 * Engine-mode aware: only `connection.kind === 'llm-profile'` modes do.
 */
export function projectedDescriptorRequiresLlmProfile(
  descriptor: ProfileConfigDescriptor
): boolean {
  return descriptor.model.kind === 'llm-profile';
}

/** Protocols the resolved engine mode accepts for its model connection (empty when external). */
export function acceptedModelProtocolsFor(mode: EngineModeDescriptor): RuntimeModelProtocol[] {
  return mode.connection.kind === 'llm-profile' ? [...mode.connection.acceptedModelProtocols] : [];
}
