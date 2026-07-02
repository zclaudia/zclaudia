import type { Usage } from '@earendil-works/pi-ai';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { ContextWindowSource } from '@zclaudia/shared/wire/messages/core';
import type { PiRunPromptBundle } from './run-prompt.js';
import {
  captureContextSnapshot,
  diffPrefixForCacheAudit,
  recordContextUsage,
} from '../context-snapshot.js';

export function capturePiRunContextSnapshot(input: {
  sessionId?: string;
  model: string;
  contextWindow: number;
  contextWindowSource: ContextWindowSource;
  prompt: PiRunPromptBundle;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tools: AgentTool<any>[];
}): void {
  if (!input.sessionId) return;
  const toolDescriptors = input.tools.map(t => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }));
  captureContextSnapshot({
    sessionId: input.sessionId,
    model: input.model,
    contextWindow: input.contextWindow,
    contextWindowSource: input.contextWindowSource,
    systemPromptText: input.prompt.snapshotSystemPromptText,
    skillCatalogText: input.prompt.snapshotSkillCatalogText,
    tools: toolDescriptors,
  });
  if (process.env.ZCLAUDIA_CACHE_AUDIT === '1') {
    const audit = diffPrefixForCacheAudit(
      input.sessionId,
      input.prompt.snapshotSystemPromptText,
      input.prompt.snapshotSkillCatalogText,
      toolDescriptors
    );
    if (!audit.firstRun && (!audit.promptStable || !audit.toolsStable)) {
      console.warn(
        `[CacheAudit] session=${input.sessionId} PREFIX CHANGED promptStable=${audit.promptStable} toolsStable=${audit.toolsStable} (prompt=${audit.promptHash} tools=${audit.toolsHash}) — provider prefix cache invalidated at this run boundary`
      );
    } else {
      console.log(
        `[CacheAudit] session=${input.sessionId} prefix stable=${!audit.firstRun} prompt=${audit.promptHash} tools=${audit.toolsHash}`
      );
    }
  }
}

export function recordPiContextUsage(input: {
  sessionId?: string;
  lastCallUsage?: Partial<Usage>;
}): void {
  if (!input.sessionId || !input.lastCallUsage) return;
  const { lastCallUsage } = input;
  recordContextUsage(input.sessionId, {
    input: lastCallUsage.input ?? 0,
    output: lastCallUsage.output ?? 0,
    cacheRead: lastCallUsage.cacheRead ?? 0,
    cacheWrite: lastCallUsage.cacheWrite ?? 0,
  });
  if (process.env.ZCLAUDIA_CACHE_AUDIT === '1') {
    const read = lastCallUsage.cacheRead ?? 0;
    const write = lastCallUsage.cacheWrite ?? 0;
    const inputTokens = lastCallUsage.input ?? 0;
    const cacheableBase = read + write + inputTokens;
    const hitPct = cacheableBase > 0 ? Math.round((read / cacheableBase) * 1000) / 10 : 0;
    console.log(
      `[CacheAudit] session=${input.sessionId} cacheRead=${read} cacheWrite=${write} input=${inputTokens} hit=${hitPct}%`
    );
  }
}
