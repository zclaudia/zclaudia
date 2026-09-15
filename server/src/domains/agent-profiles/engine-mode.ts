import { normalizeAgentRuntimeType } from '@zclaudia/shared/core/agent-profile';
import {
  defaultEngineModeFor,
  resolveProfileConfigDescriptor,
  type EngineModeSourceDescriptor,
  type ProfileConfigDescriptor,
} from '@zclaudia/shared/core/profile-config-descriptor';
import type { AgentRuntimeDescriptor } from '@zclaudia/shared/providers';
import { runtimeDescriptorRegistry } from '../../infra/providers/runtime-descriptor-registry.js';

/**
 * Engine-mode resolution for agent profiles (design: Claude §4.1/§4.2).
 *
 * The runtime descriptor (`engineModes`) owns the valid mode values. Runtimes
 * that declare no modes accept only an unset engineMode. Claude/Codex keep the
 * documented default of 'cli' even if the plugin is temporarily unavailable,
 * so a saved profile can always be interpreted — but an explicitly stored
 * unknown mode is never silently coerced.
 */

export interface EngineModeResolutionSuccess {
  ok: true;
  engineMode: string;
  /** Projection for the resolved mode (legacy fields when no modes declared). */
  projected: ProfileConfigDescriptor;
  declaredModes: string[] | null;
}

export interface EngineModeResolutionFailure {
  ok: false;
  code: 'ENGINE_MODE_UNSUPPORTED';
  message: string;
}

export type EngineModeResolution = EngineModeResolutionSuccess | EngineModeResolutionFailure;

/**
 * Documented fallback declarations for the builtin dual-mode runtimes, used
 * only while the real plugin descriptor is unavailable (fresh DB, plugin still
 * loading, plugin disabled). The registered plugin descriptor remains the
 * source of truth once present and overrides this entirely.
 */
const BUILTIN_DUAL_MODE_FALLBACKS: Record<string, EngineModeSourceDescriptor> = {
  claude: {
    label: 'Claude',
    model: { kind: 'native', multimodalFallback: false, thinkingLevel: 'auto' },
    hasCliPath: true,
    capabilities: { tools: 'native-readonly', providers: 'external', skills: 'external' },
    defaultEngineMode: 'cli',
    engineModes: [
      {
        id: 'cli',
        label: 'CLI',
        connection: { kind: 'external', modelSelection: 'optional' },
        executable: 'external-cli',
        modelOptions: { multimodalFallback: false, thinkingLevel: 'auto' },
        capabilities: { tools: 'native-readonly', skills: 'external' },
      },
      {
        id: 'sdk',
        label: 'SDK + LLM Profile',
        connection: { kind: 'llm-profile', acceptedModelProtocols: ['anthropic-messages'] },
        executable: 'bundled-sdk',
        modelOptions: { multimodalFallback: false, thinkingLevel: 'auto' },
        capabilities: { tools: 'native-readonly', skills: 'external' },
      },
    ],
  },
  codex: {
    label: 'Codex',
    model: { kind: 'native', multimodalFallback: false, thinkingLevel: 'auto' },
    hasCliPath: true,
    capabilities: { tools: 'native-readonly', providers: 'external', skills: 'external' },
    defaultEngineMode: 'cli',
    engineModes: [
      {
        id: 'cli',
        label: 'CLI',
        connection: { kind: 'external', modelSelection: 'optional' },
        executable: 'external-cli',
        modelOptions: { multimodalFallback: false, thinkingLevel: 'auto' },
        capabilities: { tools: 'native-readonly', skills: 'external' },
      },
      {
        id: 'sdk',
        label: 'SDK + LLM Profile',
        connection: { kind: 'llm-profile', acceptedModelProtocols: ['openai-responses'] },
        executable: 'bundled-engine',
        modelOptions: { multimodalFallback: false, thinkingLevel: 'auto' },
        capabilities: { tools: 'native-readonly', skills: 'external' },
      },
    ],
  },
};

/** Descriptor accessor with the builtin-plugin fallback (enabled while plugins load). */
export function getEngineModeSourceDescriptor(
  runtimeType: string
): EngineModeSourceDescriptor | undefined {
  const registered = runtimeDescriptorRegistry.get(runtimeType) as
    | (AgentRuntimeDescriptor & EngineModeSourceDescriptor)
    | undefined;
  if (registered) return registered;
  // Claude/Codex descriptor metadata may be absent before plugin registration
  // (fresh DB + plugin still loading); interpret them with their documented
  // declarations instead of failing profile reads.
  return BUILTIN_DUAL_MODE_FALLBACKS[runtimeType];
}

export function resolveProfileEngineMode(input: {
  runtimeType: string;
  engineMode?: string | null;
}): EngineModeResolution {
  input = { ...input, runtimeType: normalizeAgentRuntimeType(input.runtimeType) };
  const descriptor = getEngineModeSourceDescriptor(input.runtimeType);
  const hasDeclaredModes = !!descriptor?.engineModes?.length;

  if (!descriptor) {
    if (input.engineMode) {
      return {
        ok: false,
        code: 'ENGINE_MODE_UNSUPPORTED',
        message: `Runtime "${input.runtimeType}" is unknown; engine mode "${input.engineMode}" cannot be validated`,
      };
    }
    return {
      ok: true,
      engineMode: '',
      declaredModes: null,
      projected: {
        runtime: input.runtimeType,
        label: input.runtimeType,
        enabled: false,
        model: { kind: 'none', multimodalFallback: false, thinkingLevel: 'off' },
        hasCliPath: false,
        capabilities: { tools: 'unsupported', providers: 'unsupported', skills: 'unsupported' },
      },
    };
  }

  if (!hasDeclaredModes) {
    if (input.engineMode) {
      return {
        ok: false,
        code: 'ENGINE_MODE_UNSUPPORTED',
        message: `Runtime "${input.runtimeType}" does not declare engine modes; got "${input.engineMode}"`,
      };
    }
    // Legacy runtime: top-level descriptor fields remain canonical.
    const resolved = resolveProfileConfigDescriptor(descriptor, input.runtimeType, null);
    return {
      ok: true,
      engineMode: '',
      declaredModes: null,
      projected: resolved.ok
        ? resolved.descriptor
        : projectedFallback(descriptor, input.runtimeType),
    };
  }

  const resolved = resolveProfileConfigDescriptor(
    descriptor,
    input.runtimeType,
    input.engineMode ?? null
  );
  if (!resolved.ok) {
    return { ok: false, code: resolved.code, message: resolved.message };
  }
  return {
    ok: true,
    engineMode: resolved.engineMode,
    declaredModes: (descriptor.engineModes ?? []).map(mode => mode.id),
    projected: resolved.descriptor,
  };
}

function projectedFallback(
  descriptor: EngineModeSourceDescriptor,
  runtime: string
): ProfileConfigDescriptor {
  return {
    runtime,
    label: descriptor.label,
    enabled: true,
    model: descriptor.model,
    hasCliPath: descriptor.hasCliPath,
    capabilities: descriptor.capabilities,
    authNote: descriptor.authNote,
  };
}

/** The engine mode a profile uses when unset ('cli' for dual-mode runtimes, '' otherwise). */
export function normalizedProfileEngineMode(profile: {
  runtimeType?: string;
  engineMode?: string | null;
}): string {
  const runtimeType = normalizeAgentRuntimeType(profile.runtimeType);
  const resolution = resolveProfileEngineMode({ runtimeType, engineMode: profile.engineMode });
  if (resolution.ok) return resolution.engineMode;
  // Unknown stored mode: surface the declared default so listing endpoints stay
  // well-formed; strict validation still rejects it on write and run paths.
  const descriptor = getEngineModeSourceDescriptor(runtimeType);
  return defaultEngineModeFor(descriptor ?? { engineModes: undefined }) ?? '';
}
