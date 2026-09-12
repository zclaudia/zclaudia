import type Database from 'better-sqlite3';
import type { AgentProfileContribution } from '@zclaudia/shared/plugin-types';
import { defaultToolSelection, resolveToolSelection } from '@zclaudia/shared/core/tools';
import { AgentProfileRepository } from '../../domains/agent-profiles/repository.js';
import { LlmProfileRepository } from '../../domains/llm-profiles/repository.js';
import { isValidRuntimeType, runtimeRequiresLlmProfile } from '../../domains/agent-profiles/runtime-type-guard.js';
import { resolveProfileEngineMode } from '../../domains/agent-profiles/engine-mode.js';

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

    const requestedRuntime = contribution.runtimeType;
    const runtimeType =
      requestedRuntime && isValidRuntimeType(requestedRuntime) ? requestedRuntime : 'zclaudia';
    const requiresLlm = runtimeRequiresLlmProfile(runtimeType);
    const llmRepo = new LlmProfileRepository(this.db);
    const llmProfile = llmRepo.findDefault() ?? llmRepo.findAllOrdered()[0];
    if (requiresLlm && !llmProfile) {
      console.warn(
        `[PluginAgentProfiles] No LLM profile available for ${pluginId}/${contribution.id}`
      );
      return false;
    }

    const toolSelection = contribution.toolSelection ?? defaultToolSelection;
    const enabledTools = resolveToolSelection(toolSelection).builtinTools;

    // Dual-mode plugins (claude/codex) ship their default profile in their
    // declared default (CLI) mode with no LLM binding; SDK is an explicit user
    // opt-in. Runtimes without declared modes persist no engineMode.
    const modeResolution = resolveProfileEngineMode({ runtimeType, engineMode: 'cli' });
    const engineMode = modeResolution.ok && modeResolution.engineMode
      ? modeResolution.engineMode
      : undefined;

    agentRepo.create({
      name: contribution.name,
      description: contribution.description,
      engineMode,
      llmProfileId: requiresLlm ? llmProfile!.id : null,
      model: contribution.model ?? (requiresLlm ? llmProfile!.models?.[0]?.modelId ?? '' : ''),
      systemPrompt: contribution.systemPrompt ?? '',
      enabledTools,
      toolSelection,
      skillSelection: contribution.skillSelection,
      skillExecution: contribution.skillExecution,
      thinkingLevel: contribution.thinkingLevel,
      runtimeType,
      source: 'plugin',
      pluginId,
      pluginProfileId: contribution.id,
      isDefault: false,
    });

    return true;
  }
}
