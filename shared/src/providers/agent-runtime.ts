// shared/src/providers/agent-runtime.ts
import type { PCPProviderManifest } from '../core/pcp.js';
import type { ProviderPolicy } from '../core/provider-policy.js';
import type {
  CapabilityMode,
  ModelConfigKind,
  ThinkingLevelMode,
} from '../core/profile-config-descriptor.js';

/**
 * Everything the host needs to surface a runtime in the profile UI and to run it.
 * Declared statically in a plugin's `contributes.agentRuntimes` (JSON-serializable);
 * the live adapter is supplied imperatively via `context.agentRuntimes.register`.
 */
export interface AgentRuntimeDescriptor {
  /** Runtime type string (matches the adapter's `type`, e.g. 'claude'). */
  type: string;
  label: string;
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
  authNote?: string;
  /** PCP capability manifest used by the run path. */
  manifest: PCPProviderManifest;
  /** Runtime policy (native interaction tools, escalate-always, etc.). */
  policy?: ProviderPolicy;
}

/** Manifest contribution shape (identical to the descriptor). */
export type AgentRuntimeContribution = AgentRuntimeDescriptor;
