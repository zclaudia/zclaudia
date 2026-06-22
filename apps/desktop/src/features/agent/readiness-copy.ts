import type { AgentReadinessReason } from '@zclaudia/shared/core/agent-readiness';
import type { SettingsTab } from '../settings/settingsTabDefs';

export interface ReadinessGuidance {
  title: string;
  body: string;
  settingsTab: Extract<SettingsTab, 'providers' | 'agents'>;
}

/** Maps a readiness reason to user-facing copy and the settings tab to open. */
export function readinessGuidance(reason: AgentReadinessReason | undefined): ReadinessGuidance {
  switch (reason) {
    case 'no_agent':
      return {
        title: 'No agent available yet',
        body: "You haven't configured an agent yet. Create one to get started.",
        settingsTab: 'agents',
      };
    case 'no_llm_profile':
      return {
        title: 'No agent available yet',
        body: 'This agent has no model provider linked. Configure one to continue.',
        settingsTab: 'providers',
      };
    case 'no_model':
      return {
        title: 'No agent available yet',
        body: "The agent's selected model isn't configured, or isn't in the list of models offered by its provider. Pick an available model in the agent settings.",
        settingsTab: 'agents',
      };
    case 'no_credential':
    default:
      return {
        title: 'No agent available yet',
        body: 'The model provider is missing an API key (or login credentials). Add one to continue.',
        settingsTab: 'providers',
      };
  }
}
