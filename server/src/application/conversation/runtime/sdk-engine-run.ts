import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import type { LlmProfileConfig } from '@zclaudia/shared/core/llm-profile';
import type { RuntimeModelConnection } from '@zclaudia/shared/providers';
import { LlmProfileRepository } from '../../../domains/llm-profiles/repository.js';
import { resolveRuntimeModelConnection } from '../../../domains/agent-profiles/runtime-model-connection.js';
import { readSessionModelSelection } from '../../../domains/sessions/model-settings-repository.js';
import { SessionRuntimeBindingRepository } from '../../../domains/sessions/runtime-binding-repository.js';
import {
  computeConnectionIdentityHash,
  connectionIdentityHashesMatch,
  getOrCreateRuntimeBindingKey,
} from '../../../infra/services/runtime-binding-key.js';
import { resolveBundledRuntimeResource } from '../../../infra/agents/bundled-runtime-resources.js';
import { resolveDataDir } from '../../../utils/data-dir.js';
import { RunLaunchError } from './run-launch-error.js';

/**
 * SDK engine-mode run preparation (design: Claude §5/§6, Codex §5/§6/§7).
 *
 * Order matters and runs inside the per-session run mutex:
 *   1. binding resolution (bound sessions run their original identity),
 *   2. strict connection resolution against the bound profile,
 *   3. bundled engine resource verification,
 *   4. connection-identity + workspace checks (fail BEFORE any request),
 *   5. config directory preparation + binding persistence,
 * then the caller starts the adapter with engineExecution/modelConnection.
 */

export interface PrepareSdkEngineRunInput {
  db: Database.Database;
  runtimeType: string;
  claudiaSessionId: string;
  cwd: string;
  /** Model the (possibly binding-adjusted) agent resolves to before this override. */
  agentModel: string;
  /** Default before applying session overrides, retained for Reset to default. */
  inheritedModel?: string;
  /** LLM profile resolved from the agent's current configuration by run-bootstrap. */
  resolvedLlmProfile: LlmProfileConfig | undefined;
  resolvedLlmProfileId: string | null;
}

export interface PreparedSdkEngineRun {
  model: string;
  executablePath: string;
  executableSource: 'bundled-sdk' | 'bundled-engine';
  configDirectory: string;
  connection: RuntimeModelConnection;
  protocol: string;
  profileId: string | null;
  bindingCreated: boolean;
}

function normalizeCwdForCompare(cwd: string): string {
  return path.resolve(cwd);
}

/** Session-scoped config directory: <data-dir>/agent-runtime-state/<rt>/sdk/<sessionId>. */
export function sdkConfigDirectory(runtimeType: string, claudiaSessionId: string): string {
  return path.join(resolveDataDir(), 'agent-runtime-state', runtimeType, 'sdk', claudiaSessionId);
}

/** Relative logical namespace persisted in the binding (never an absolute install path). */
export function sdkConfigNamespace(runtimeType: string, claudiaSessionId: string): string {
  return path.posix.join('agent-runtime-state', runtimeType, 'sdk', claudiaSessionId);
}

export async function prepareSdkEngineRun(
  input: PrepareSdkEngineRunInput
): Promise<PreparedSdkEngineRun> {
  const { db, runtimeType, claudiaSessionId, cwd } = input;
  const bindingRepo = new SessionRuntimeBindingRepository(db);
  const llmRepo = new LlmProfileRepository(db);

  // 1. Binding first: a bound session runs its original identity, not the
  // agent's latest configuration.
  const binding = bindingRepo.findBySessionId(claudiaSessionId);
  if (binding && (binding.runtimeType !== runtimeType || binding.engineMode !== 'sdk')) {
    throw new RunLaunchError(
      'SESSION_CONNECTION_CHANGED',
      'The requested runtime does not match this session binding. Start a new session to change runtime or engine mode.'
    );
  }
  const boundProfileId = binding
    ? binding.llmProfileId
    : (input.resolvedLlmProfileId ?? input.resolvedLlmProfile?.id ?? null);
  // The resolver already applied the session's explicit model selection.
  // Connection identity remains pinned independently of model selection.
  const selection = readSessionModelSelection(db, claudiaSessionId);
  const model = (selection.model ?? binding?.model ?? input.agentModel ?? '').trim();

  let profile: LlmProfileConfig | undefined = input.resolvedLlmProfile;
  if (binding) {
    profile = undefined;
    if (binding.llmProfileId) {
      profile = llmRepo.findById(binding.llmProfileId) ?? undefined;
      if (!profile) {
        throw new RunLaunchError(
          'LLM_PROFILE_NOT_FOUND',
          `The LLM profile bound to this session no longer exists. Restore it or start a new session.`
        );
      }
    }
  } else {
    profile = boundProfileId ? (llmRepo.findById(boundProfileId) ?? undefined) : undefined;
  }

  // 2. Strict connection resolution (protocol admission, auth, headers).
  const resolution = resolveRuntimeModelConnection({
    runtimeType,
    profile: profile ?? null,
    model,
  });
  if (!resolution.ok) {
    throw new RunLaunchError(resolution.code, resolution.message);
  }

  // 3. Bundled engine resource — never fall back to PATH or managed installs.
  const resource = resolveBundledRuntimeResource(runtimeType);
  if (resource === undefined) {
    throw new RunLaunchError(
      'SDK_ENGINE_UNAVAILABLE',
      `The bundled engine for "${runtimeType}" could not be located because the plugin directory is unknown in this process`
    );
  }
  if (!resource.available) {
    throw new RunLaunchError(resource.code, resource.reason);
  }

  // 4. Connection identity integrity (HMAC over protocol/endpoint/auth/headers;
  // the API key itself never participates, so key rotation stays allowed).
  const hasExistingIdentities = bindingRepo.countWithConnectionIdentity() > 0;
  const key = getOrCreateRuntimeBindingKey({ allowCreate: !hasExistingIdentities });
  const identityHash = computeConnectionIdentityHash(key, resolution.identity);
  if (
    binding?.connectionIdentityHash &&
    !connectionIdentityHashesMatch(binding.connectionIdentityHash, identityHash)
  ) {
    throw new RunLaunchError(
      'SESSION_CONNECTION_CHANGED',
      'The LLM profile bound to this session changed its endpoint, protocol, or routing. Restore the original profile configuration or start a new session — the existing conversation is not sent to the new connection.'
    );
  }

  // Workspace drift check: the provider session is bound to the directory it
  // started in; resuming against a different checkout risks writing elsewhere.
  const boundCwd = binding?.runtimeDetails?.cwd;
  if (boundCwd && normalizeCwdForCompare(boundCwd) !== normalizeCwdForCompare(cwd)) {
    throw new RunLaunchError(
      'SESSION_WORKSPACE_CHANGED',
      `This session is bound to ${boundCwd} but was opened from ${cwd}. Reopen it in the original workspace or start a new session.`
    );
  }

  // 5. Config directory preparation + binding persistence (before engine start).
  const configDirectory = sdkConfigDirectory(runtimeType, claudiaSessionId);
  mkdirSync(configDirectory, { recursive: true, mode: 0o700 });
  let bindingCreated = false;
  if (!binding) {
    bindingRepo.upsert({
      sessionId: claudiaSessionId,
      runtimeType,
      engineMode: 'sdk',
      model: input.inheritedModel ?? (model || null),
      llmProfileId: boundProfileId,
      connectionIdentityHash: identityHash,
      configuredCliPath: null,
      configNamespace: sdkConfigNamespace(runtimeType, claudiaSessionId),
      runtimeDetails: {
        schemaVersion: 1,
        providerId:
          resolution.connection.protocol === 'openai-responses' ? 'zclaudia_profile' : undefined,
        cwd: normalizeCwdForCompare(cwd),
      },
    });
    bindingCreated = true;
  }

  return {
    model,
    executablePath: resource.executablePath,
    executableSource: resource.kind,
    configDirectory,
    connection: resolution.connection,
    protocol: resolution.connection.protocol,
    profileId: profile?.id ?? null,
    bindingCreated,
  };
}
