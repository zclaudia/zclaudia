import { streamSimple } from '@earendil-works/pi-ai';
import {
  Agent,
  type AgentEvent,
  type AgentMessage,
  type AgentTool,
  type ShouldStopAfterTurnContext,
  type StreamFn,
} from '@earendil-works/pi-agent-core';
import type { BuiltModel } from '../build-model.js';
import type { AgentHooksOutput } from '../agent-hooks.js';
import { withStreamRetry } from '../retry-stream.js';
import { extractErrorStop, extractLastCallUsage, extractUsage } from '../usage-extractor.js';

export interface AgentLoopExecutorInput {
  systemPrompt: string;
  userInput: string;
  history: AgentMessage[];
  modelInfo: BuiltModel;
  tools: AgentTool[];
  hooks: AgentHooksOutput;
  timeoutMs: number;
  maxTurns: number;
  sessionId: string;
  cacheRetention?: 'none' | 'short' | 'long';
  streamFn?: StreamFn;
}

export interface AgentLoopExecutorResult {
  text: string;
  messages: AgentMessage[];
  usage?: unknown;
}

export type AgentLoopExecutor = (input: AgentLoopExecutorInput) => Promise<AgentLoopExecutorResult>;

export class AgentLoopTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Lightweight agent loop timed out after ${timeoutMs}ms`);
    this.name = 'AgentLoopTimeoutError';
  }
}

export const runPiAgentLoop: AgentLoopExecutor = async (input) => {
  const baseStreamFn: StreamFn = input.hooks.streamFn ?? input.streamFn ?? streamSimple;
  const cacheRetention = input.cacheRetention;
  const cachedStreamFn: StreamFn = cacheRetention
    ? (((model, context, options) => baseStreamFn(model, context, { ...options, cacheRetention })) as StreamFn)
    : baseStreamFn;

  let completedTurns = 0;
  const agentOptions: ConstructorParameters<typeof Agent>[0] = {
    initialState: {
      systemPrompt: input.systemPrompt,
      model: input.modelInfo.model,
      messages: input.history,
      tools: input.tools,
    },
    beforeToolCall: input.hooks.beforeToolCall,
    afterToolCall: input.hooks.afterToolCall,
    shouldStopAfterTurn: async (context: ShouldStopAfterTurnContext) => {
      completedTurns += 1;
      const hookStop = await input.hooks.shouldStopAfterTurn?.(context);
      return Boolean(hookStop) || completedTurns >= input.maxTurns;
    },
    sessionId: input.sessionId,
    streamFn: withStreamRetry(cachedStreamFn),
    ...(input.hooks.transformContext ? { transformContext: input.hooks.transformContext } : {}),
    ...(input.modelInfo.getApiKey ? { getApiKey: input.modelInfo.getApiKey } : {}),
  };

  const agent = new Agent(agentOptions);
  let finalMessages: AgentMessage[] = [];
  let finalText = '';
  let finalUsage: unknown;
  let terminalError: Error | undefined;

  const unsubscribe = agent.subscribe((event: AgentEvent) => {
    if (event.type !== 'agent_end') return;

    finalMessages = event.messages;
    finalUsage = extractUsage(finalMessages) ?? extractLastCallUsage(finalMessages);
    const errorReason = extractErrorStop(finalMessages);
    if (errorReason) {
      terminalError = new Error(`LLM call failed: ${errorReason}`);
      return;
    }
    finalText = extractAssistantText(finalMessages);
  });

  try {
    await withTimeout(agent.prompt(input.userInput), input.timeoutMs, () => {
      agent.abort();
    });
    if (terminalError) throw terminalError;
    return {
      text: finalText,
      messages: finalMessages,
      usage: finalUsage,
    };
  } finally {
    unsubscribe();
    agent.abort();
  }
};

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout: () => void,
): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => {
          onTimeout();
          reject(new AgentLoopTimeoutError(timeoutMs));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function extractAssistantText(messages: AgentMessage[]): string {
  const lastAssistant = [...messages].reverse().find((message) => message.role === 'assistant');
  if (!lastAssistant) return '';

  const content = lastAssistant.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  return content
    .map((part) => {
      if (typeof part === 'object' && part && 'text' in part) {
        return String((part as { text: unknown }).text ?? '');
      }
      return '';
    })
    .filter(Boolean)
    .join('\n');
}
