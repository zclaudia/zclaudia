import { normalizeAgentRuntimeType } from '@zclaudia/shared/core/agent-profile';
import type { AgentProfileConfig } from '@zclaudia/shared/core/agent-profile';
import type { LlmProfileRepository } from '../llm-profiles/repository.js';
import { resolveProfileEngineMode, getEngineModeSourceDescriptor } from './engine-mode.js';
import { resolveRuntimeModelConnection } from './runtime-model-connection.js';

/**
 * Engine-mode-aware configuration validation for agent profile create/PATCH
 * (design: Claude §4.1, Codex §4.1).
 *
 * The requested change is validated as a whole merged configuration: an SDK
 * profile must always carry profile + model (no transient "sdk without
 * connection" states, no matter which single field the client touched), while
 * CLI profiles never let a bound LLM profile act as the engine connection.
 */

export interface EngineModeConfigValidationInput {
  runtimeType: string;
  /** Engine mode as requested on the wire; omitted means "keep existing / unset". */
  requestedEngineMode?: string | null;
  /** True when the request payload explicitly contained the engineMode key. */
  engineModeExplicit: boolean;
  mergedLlmProfileId: string | null | undefined;
  mergedModel: string;
  mergedCliPath: string | null | undefined;
  llmRepo: LlmProfileRepository;
}

export type EngineModeConfigValidation =
  | {
      ok: true;
      /** Normalized engine mode ('' for runtimes without declared modes). */
      engineMode: string;
      /** LLM binding to persist (null = no binding). */
      llmProfileId: string | null;
      /** True when the mode rules force-clear the LLM binding. */
      llmProfileIdForced: boolean;
      requiresLlmProfile: boolean;
    }
  | {
      ok: false;
      status: 400;
      code: string;
      message: string;
    };

export function validateEngineModeConfiguration(
  input: EngineModeConfigValidationInput
): EngineModeConfigValidation {
  return validateImpl(input);
}

function validateImpl(input: EngineModeConfigValidationInput): EngineModeConfigValidation {
  const modeResolution = resolveProfileEngineMode({
    runtimeType: input.runtimeType,
    engineMode: input.requestedEngineMode ?? null,
  });
  if (!modeResolution.ok) {
    return { ok: false, status: 400, code: modeResolution.code, message: modeResolution.message };
  }

  const engineMode = modeResolution.engineMode;
  // Only runtimes that declare engine modes get SDK connection admission;
  // classic llm-profile runtimes (Pi) keep their original semantics.
  const isDualMode = modeResolution.declaredModes !== null;
  const requiresLlm = modeResolution.projected.model.kind === 'llm-profile';

  if (requiresLlm) {
    const llmProfileId = input.mergedLlmProfileId ?? null;
    if (!llmProfileId) {
      return {
        ok: false,
        status: 400,
        code: 'LLM_PROFILE_REQUIRED',
        message: `Engine mode "${engineMode}" requires a bound LLM profile`,
      };
    }
    if (!input.llmRepo.findById(llmProfileId)) {
      return {
        ok: false,
        status: 400,
        code: 'LLM_PROFILE_NOT_FOUND',
        message: `llmProfileId not found: ${llmProfileId}`,
      };
    }
    if (!input.mergedModel.trim()) {
      return {
        ok: false,
        status: 400,
        code: 'LLM_OPTION_UNSUPPORTED',
        message: `Engine mode "${engineMode}" requires an explicit model`,
      };
    }
    if (input.mergedCliPath && input.mergedCliPath.trim()) {
      return {
        ok: false,
        status: 400,
        code: 'FIELD_NOT_APPLICABLE',
        message: 'cliPath does not apply in SDK mode — the executable is delivered with the app',
      };
    }
    if (isDualMode) {
      const profile = input.llmRepo.findById(llmProfileId)!;
      const connection = resolveRuntimeModelConnection({
        runtimeType: input.runtimeType,
        profile,
        model: input.mergedModel,
      });
      if (!connection.ok) {
        return {
          ok: false,
          status: 400,
          code: connection.code,
          message: connection.message,
        };
      }
    }
    return {
      ok: true,
      engineMode,
      llmProfileId,
      llmProfileIdForced: false,
      requiresLlmProfile: true,
    };
  }

  // CLI (or external) mode. New profiles and explicit mode switches clear the
  // LLM binding; untouched legacy bindings on existing CLI records are kept
  // (they are never used as the engine connection, but wiping user data on an
  // unrelated edit is not ours to do).
  if (input.engineModeExplicit) {
    return {
      ok: true,
      engineMode,
      llmProfileId: null,
      llmProfileIdForced: true,
      requiresLlmProfile: false,
    };
  }
  return {
    ok: true,
    engineMode,
    llmProfileId: input.mergedLlmProfileId ?? null,
    llmProfileIdForced: false,
    requiresLlmProfile: false,
  };
}

/** Normalized engine mode for API responses (declared default when unset). */
export function engineModeForResponse(profile: AgentProfileConfig): string | undefined {
  const resolution = resolveProfileEngineMode({
    runtimeType: normalizeAgentRuntimeType(profile.runtimeType),
    engineMode: profile.engineMode ?? null,
  });
  if (resolution.ok) return resolution.engineMode || undefined;
  // Unknown stored mode: report the descriptor default; strict validation on
  // write/run paths still rejects it.
  const descriptor = getEngineModeSourceDescriptor(normalizeAgentRuntimeType(profile.runtimeType));
  if (descriptor?.engineModes?.length) {
    return descriptor.defaultEngineMode ?? descriptor.engineModes[0]!.id;
  }
  return undefined;
}
