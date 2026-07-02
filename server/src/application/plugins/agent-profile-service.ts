import type Database from 'better-sqlite3';
import type { AgentProfileContribution } from '@zclaudia/shared/plugin-types';
import { defaultToolSelection, resolveToolSelection } from '@zclaudia/shared/core/tools';
import { AgentProfileRepository } from '../../domains/agent-profiles/repository.js';
import { LlmProfileRepository } from '../../domains/llm-profiles/repository.js';

export class PluginAgentProfileService {
  constructor(private readonly db: Database.Database) {}

  installContributions(pluginId: string, profiles: AgentProfileContribution[] | undefined): number {
    if (!profiles || profiles.length === 0) return 0;

    let installed = 0;
    for (const profile of profiles) {
      if (this.installOne(pluginId, profile)) installed += 1;
    }
    return installed;
  }

  private installOne(pluginId: string, contribution: AgentProfileContribution): boolean {
    const agentRepo = new AgentProfileRepository(this.db);
    const existing = agentRepo.findByPluginProfile(pluginId, contribution.id);
    if (existing) return false;

    const llmRepo = new LlmProfileRepository(this.db);
    const llmProfile = llmRepo.findDefault() ?? llmRepo.findAllOrdered()[0];
    if (!llmProfile) {
      console.warn(
        `[PluginAgentProfiles] No LLM profile available for ${pluginId}/${contribution.id}`
      );
      return false;
    }

    const toolSelection = contribution.toolSelection ?? defaultToolSelection;
    const enabledTools = resolveToolSelection(toolSelection).builtinTools;

    agentRepo.create({
      name: contribution.name,
      description: contribution.description,
      llmProfileId: llmProfile.id,
      model: contribution.model ?? llmProfile.models?.[0]?.modelId ?? 'claude-sonnet-4-6',
      systemPrompt: contribution.systemPrompt ?? '',
      enabledTools,
      toolSelection,
      skillSelection: contribution.skillSelection,
      skillExecution: contribution.skillExecution,
      thinkingLevel: contribution.thinkingLevel,
      source: 'plugin',
      pluginId,
      pluginProfileId: contribution.id,
      isDefault: false,
    });

    return true;
  }
}
