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
        title: '还没有可用的 Agent',
        body: '你还没有配置 Agent。先创建一个 Agent 才能开始。',
        settingsTab: 'agents',
      };
    case 'no_llm_profile':
      return {
        title: '还没有可用的 Agent',
        body: 'Agent 还没有关联可用的模型 Provider。去配置一个。',
        settingsTab: 'providers',
      };
    case 'no_model':
      return {
        title: '还没有可用的 Agent',
        body: 'Agent 选用的模型未配置，或不在该 Provider 提供的模型列表中。去 Agent 设置里改用一个可用的模型。',
        settingsTab: 'agents',
      };
    case 'no_credential':
    default:
      return {
        title: '还没有可用的 Agent',
        body: '模型 Provider 还缺少 API Key（或登录凭据）。补上后即可使用。',
        settingsTab: 'providers',
      };
  }
}
