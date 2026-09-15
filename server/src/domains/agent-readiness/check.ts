import { normalizeAgentRuntimeType } from '@zclaudia/shared/core/agent-profile';
import type Database from 'better-sqlite3';
import type { AgentReadiness } from '@zclaudia/shared/core/agent-readiness';
import type { AgentProfileConfig } from '@zclaudia/shared/core/agent-profile';
import type { LlmProfileConfig } from '@zclaudia/shared/core/llm-profile';
import type { ManagedRuntimeResolution } from '@zclaudia/shared/plugins/managed-runtimes';
import { AgentProfileRepository } from '../agent-profiles/repository.js';
import { LlmProfileRepository } from '../llm-profiles/repository.js';
import { hasLlmCredential } from './credential.js';
import { runtimeRequiresLlmProfile } from '../agent-profiles/runtime-type-guard.js';
import { resolveProfileEngineMode } from '../agent-profiles/engine-mode.js';
import { resolveRuntimeModelConnection } from '../agent-profiles/runtime-model-connection.js';
import { resolveBundledRuntimeResource } from '../../infra/agents/bundled-runtime-resources.js';
import { providerRegistry } from '../../infra/providers/registry.js';
import {
  findInRegistryCrossProvider,
  tryGetRegistryModel,
} from '../../infra/providers/pi-runtime/registry-search.js';
import {
  NoAgentAvailableError,
  resolveAgentForSession,
  type ResolveOptions,
} from '../agent-profiles/agent-resolver.js';

/**
 * Whether the agent's chosen model is usable for its resolved profile.
 *
 * Structural-only: usable iff the model is non-blank AND either the profile
 * explicitly declares it in models[] or pi-ai's registry knows the id. This
 * rejects typo/nonexistent model ids before creating sessions.
 */
export function hasUsableModel(agentModel: string | undefined, llm: LlmProfileConfig): boolean {
  const model = agentModel?.trim();
  if (!model) return false;
  const declared = llm.models;
  if (declared && declared.length > 0) {
    return declared.some(m => m.modelId === model);
  }
  return Boolean(
    tryGetRegistryModel(llm.providerType, model) ?? findInRegistryCrossProvider(model)
  );
}

function readinessForResolvedAgent(
  agent: AgentProfileConfig | undefined,
  llm: LlmProfileConfig | null | undefined
): AgentReadiness {
  if (!agent) return { usable: false, reason: 'no_agent' };
  const runtimeType = normalizeAgentRuntimeType(agent.runtimeType);

  // Layer 1: engine mode validity. An explicitly stored unknown mode fails
  // closed instead of silently executing under another mode.
  const engineMode = resolveProfileEngineMode({
    runtimeType,
    engineMode: agent.engineMode ?? null,
  });
  if (!engineMode.ok) return { usable: false, reason: 'engine_mode_unsupported' };
  // Only runtimes that DECLARE engine modes route through the SDK checks;
  // classic llm-profile runtimes (zclaudia) keep their original semantics.
  const modeRequiresLlm =
    engineMode.declaredModes !== null && engineMode.projected.model.kind === 'llm-profile';

  if (modeRequiresLlm) {
    // Layer 2 (SDK mode): the bound profile is mandatory — no default fallback,
    // credential required, protocol must be admitted for this runtime, model
    // must be structurally usable, and the bundled engine resource must exist.
    if (!providerRegistry.hasType(runtimeType)) {
      return { usable: false, reason: 'runtime_unavailable' };
    }
    if (!llm) return { usable: false, reason: 'no_llm_profile' };
    if (!hasLlmCredential(llm)) return { usable: false, reason: 'no_credential' };
    const connection = resolveRuntimeModelConnection({
      runtimeType,
      profile: llm,
      model: agent.model,
    });
    if (!connection.ok) {
      if (
        connection.code === 'LLM_PROFILE_FIELD_UNSUPPORTED' ||
        connection.code === 'LLM_OPTION_UNSUPPORTED'
      ) {
        return { usable: false, reason: 'llm_option_unsupported' };
      }
      return { usable: false, reason: 'llm_protocol_unsupported' };
    }
    if (!hasUsableModel(agent.model, llm)) return { usable: false, reason: 'no_model' };
    const resource = resolveBundledRuntimeResource(runtimeType);
    if (resource && !resource.available) return { usable: false, reason: 'sdk_engine_unavailable' };
    return { usable: true };
  }

  // Layer 2 (CLI / external mode): native runtimes don't bind an LLM profile.
  // A blank model means the native CLI/SDK resolves its configured default model.
  if (!runtimeRequiresLlmProfile(runtimeType)) {
    if (!providerRegistry.hasType(runtimeType)) {
      return { usable: false, reason: 'runtime_unavailable' };
    }
    return { usable: true };
  }
  if (!llm) return { usable: false, reason: 'no_llm_profile' };
  if (!hasLlmCredential(llm)) return { usable: false, reason: 'no_credential' };
  if (!hasUsableModel(agent.model, llm)) return { usable: false, reason: 'no_model' };
  return { usable: true };
}

type RuntimeInspector = (
  agent: AgentProfileConfig
) => Promise<ManagedRuntimeResolution | undefined>;
let inspectRuntime: RuntimeInspector | undefined;

/** Application composition supplies the CLI service without a domain-to-application dependency. */
export function configureRuntimeReadinessInspector(inspector: RuntimeInspector): void {
  inspectRuntime = inspector;
}

export async function resolveAgentExecutionReadiness(
  agent: AgentProfileConfig,
  llm: LlmProfileConfig | null | undefined
): Promise<AgentReadiness> {
  const structural = readinessForResolvedAgent(agent, llm);
  // LLM-bound runtimes and SDK engine modes skip the CLI inspector entirely:
  // an SDK run's engine is the bundled resource (checked structurally), and an
  // external `auth status` probe must never gate it.
  const engineMode = resolveProfileEngineMode({
    runtimeType: normalizeAgentRuntimeType(agent.runtimeType),
    engineMode: agent.engineMode ?? null,
  });
  const skipsInspector =
    (engineMode.ok && engineMode.projected.model.kind === 'llm-profile') ||
    runtimeRequiresLlmProfile(agent.runtimeType);
  if (!structural.usable || skipsInspector || !inspectRuntime) return structural;
  try {
    const resolution = await inspectRuntime(agent);
    if (!resolution) return structural;
    if (resolution.status === 'auth-required' || resolution.authState === 'auth-required')
      return { usable: false, reason: 'runtime_auth_required' };
    if (resolution.status === 'resolved') return { usable: true };
    if (resolution.compatibilityState === 'probe-failed')
      return { usable: false, reason: 'runtime_check_failed' };
    if (['too-old', 'known-incompatible', 'unparseable'].includes(resolution.compatibilityState))
      return { usable: false, reason: 'runtime_incompatible' };
    return { usable: false, reason: 'runtime_missing' };
  } catch {
    return { usable: false, reason: 'runtime_check_failed' };
  }
}

export async function resolveAgentReadinessWithRuntimeCheck(
  db: Database.Database
): Promise<AgentReadiness> {
  const repo = new AgentProfileRepository(db);
  const agents = repo.findAllOrdered();
  if (!agents.length) return { usable: false, reason: 'no_agent' };
  const llms = new LlmProfileRepository(db);
  const readiness = await Promise.all(
    agents.map(agent =>
      resolveAgentExecutionReadiness(
        agent,
        agent.llmProfileId ? llms.findById(agent.llmProfileId) : undefined
      )
    )
  );
  if (readiness.some(item => item.usable)) return { usable: true };
  const primary = repo.findDefault() ?? agents[0];
  return readiness[agents.findIndex(agent => agent.id === primary.id)];
}

export async function resolveAgentReadinessForSessionWithRuntimeCheck(
  db: Database.Database,
  opts: ResolveOptions
): Promise<AgentReadiness> {
  try {
    const { agent, llm } = resolveAgentForSession(db, opts);
    return await resolveAgentExecutionReadiness(agent, llm);
  } catch (err) {
    if (err instanceof NoAgentAvailableError) return { usable: false, reason: 'no_agent' };
    throw err;
  }
}

/**
 * Structural readiness: usable iff at least one agent profile resolves to an LLM
 * profile with a non-empty credential AND a usable model. When unusable, reports
 * the most actionable reason derived from the default (or first) agent.
 */
export function resolveAgentReadiness(db: Database.Database): AgentReadiness {
  const agentRepo = new AgentProfileRepository(db);
  const agents = agentRepo.findAllOrdered();
  if (agents.length === 0) return { usable: false, reason: 'no_agent' };

  const llmRepo = new LlmProfileRepository(db);
  for (const agent of agents) {
    const llm = agent.llmProfileId ? llmRepo.findById(agent.llmProfileId) : undefined;
    if (readinessForResolvedAgent(agent, llm).usable) return { usable: true };
  }

  const primary = agentRepo.findDefault() ?? agents[0];
  const llm = primary.llmProfileId ? llmRepo.findById(primary.llmProfileId) : undefined;
  return readinessForResolvedAgent(primary, llm);
}

/**
 * Readiness for the exact agent that SessionRepository will assign:
 * explicit > project default > global default.
 */
export function resolveAgentReadinessForSession(
  db: Database.Database,
  opts: ResolveOptions
): AgentReadiness {
  try {
    const { agent, llm } = resolveAgentForSession(db, opts);
    return readinessForResolvedAgent(agent, llm);
  } catch (err) {
    if (err instanceof NoAgentAvailableError) return { usable: false, reason: 'no_agent' };
    throw err;
  }
}
