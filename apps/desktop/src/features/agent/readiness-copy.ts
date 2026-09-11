import type { AgentReadinessReason } from '@zclaudia/shared/core/agent-readiness';
import type { AgentsTab } from '../agents/agents-types';

/**
 * Where "Configure →" should navigate: the Agents shell mode, optionally on a
 * specific tab (omitted = the default Profiles tab).
 */
export interface ReadinessDestination {
  kind: 'agents';
  tab?: AgentsTab;
}

export interface ReadinessGuidance {
  title: string;
  body: string;
  destination: ReadinessDestination;
}

/** Maps a readiness reason to user-facing copy and where "Configure →" should navigate. */
export function readinessGuidance(reason: AgentReadinessReason | undefined): ReadinessGuidance {
  switch (reason) {
    case 'runtime_missing':
      return {
        title: 'CLI not available',
        body: 'Install this runtime in Built-in plugins, or set an executable path in the agent profile.',
        destination: { kind: 'agents' },
      };
    case 'runtime_incompatible':
      return {
        title: 'CLI version incompatible',
        body: 'Choose a supported CLI version in Built-in plugins, or update the executable path in the agent profile.',
        destination: { kind: 'agents' },
      };
    case 'runtime_auth_required':
      return {
        title: 'CLI login required',
        body: "Complete this CLI's login flow on the connected backend, then retry.",
        destination: { kind: 'agents' },
      };
    case 'runtime_check_failed':
      return {
        title: 'CLI could not be checked',
        body: 'Review the executable path and CLI status in Built-in plugins, then retry.',
        destination: { kind: 'agents' },
      };
    case 'runtime_unavailable':
      return {
        title: 'Agent runtime unavailable',
        body: 'Enable this runtime in Built-in plugins, or choose an available agent.',
        destination: { kind: 'agents' },
      };
    case 'no_agent':
      return {
        title: 'No agent available yet',
        body: "You haven't configured an agent yet. Create one to get started.",
        destination: { kind: 'agents' },
      };
    case 'no_llm_profile':
      return {
        title: 'No agent available yet',
        body: 'This agent has no model provider linked. Configure one to continue.',
        destination: { kind: 'agents', tab: 'providers' },
      };
    case 'no_model':
      return {
        title: 'No agent available yet',
        body: "The agent's selected model isn't configured, or isn't in the list of models offered by its provider. Pick an available model in the agent's profile.",
        destination: { kind: 'agents' },
      };
    case 'no_credential':
    default:
      return {
        title: 'No agent available yet',
        body: 'The model provider is missing an API key (or login credentials). Add one to continue.',
        destination: { kind: 'agents', tab: 'providers' },
      };
  }
}
