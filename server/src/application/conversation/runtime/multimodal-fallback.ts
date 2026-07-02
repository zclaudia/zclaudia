import type Database from 'better-sqlite3';
import type { AgentProfileConfig } from '@zclaudia/shared/core/agent-profile';
import type { LlmProfileConfig, LlmProfileModelEntry } from '@zclaudia/shared/core/llm-profile';
import { LlmProfileRepository } from '../../../domains/llm-profiles/repository.js';
import { buildModel } from '../../../infra/providers/pi-runtime/build-model.js';
import type { ResolvedImage } from './resolve-image-attachments.js';

export interface MultimodalFallbackResolution {
  agentProfile: AgentProfileConfig;
  llmProfile?: LlmProfileConfig;
  llmProfileId: string;
  providerType: string;
  applied: boolean;
}

function modelEntryFor(
  profile: LlmProfileConfig | undefined,
  model: string
): LlmProfileModelEntry | undefined {
  return profile?.models?.find(entry => entry.modelId === model);
}

function modelSupportsImage(profile: LlmProfileConfig | undefined, model: string): boolean {
  const built = buildModel(profile, model, modelEntryFor(profile, model));
  const input = (built.model as { input?: string[] }).input;
  return Array.isArray(input) && input.includes('image');
}

export function resolveMultimodalFallbackForRun(input: {
  db: Database.Database;
  agentProfile: AgentProfileConfig;
  llmProfile?: LlmProfileConfig;
  images: ResolvedImage[];
}): MultimodalFallbackResolution {
  const { db, agentProfile, llmProfile, images } = input;
  const primaryLlmProfile = llmProfile;

  const primary: MultimodalFallbackResolution = {
    agentProfile,
    llmProfile: primaryLlmProfile,
    llmProfileId: primaryLlmProfile?.id ?? agentProfile.llmProfileId,
    providerType: primaryLlmProfile?.providerType ?? 'zclaudia',
    applied: false,
  };

  if (images.length === 0 || !primaryLlmProfile) return primary;
  if (modelSupportsImage(primaryLlmProfile, agentProfile.model)) return primary;

  const fallback = agentProfile.multimodalFallback;
  if (!fallback) return primary;

  const fallbackProfile = new LlmProfileRepository(db).findById(fallback.llmProfileId);
  if (!fallbackProfile) {
    throw new Error(`Multimodal fallback LLM profile not found: ${fallback.llmProfileId}`);
  }
  if (!modelSupportsImage(fallbackProfile, fallback.model)) {
    throw new Error(
      `Multimodal fallback model "${fallback.model}" on LLM profile "${fallbackProfile.name}" does not support image input. Enable Vision on that model or choose another fallback.`
    );
  }

  return {
    agentProfile: {
      ...agentProfile,
      llmProfileId: fallbackProfile.id,
      model: fallback.model,
    },
    llmProfile: fallbackProfile,
    llmProfileId: fallbackProfile.id,
    providerType: fallbackProfile.providerType,
    applied: true,
  };
}
