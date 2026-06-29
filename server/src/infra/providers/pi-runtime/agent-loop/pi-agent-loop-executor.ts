import { streamSimple } from '@earendil-works/pi-ai';
import {
  type AgentEvent,
  type AgentContext,
  type AgentLoopConfig,
  type AgentMessage,
  type AgentTool,
  convertToLlm,
  runAgentLoop,
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
  maxTurns?: number;
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
  const context: AgentContext = {
    systemPrompt: input.systemPrompt,
    messages: input.history,
    tools: input.tools,
  };
  const config: AgentLoopConfig = {
    model: input.modelInfo.model,
    beforeToolCall: input.hooks.beforeToolCall,
    afterToolCall: input.hooks.afterToolCall,
    shouldStopAfterTurn: async (context) => {
      completedTurns += 1;
      const hookStop = await input.hooks.shouldStopAfterTurn?.(context);
      return Boolean(hookStop) || (typeof input.maxTurns === 'number' && completedTurns >= input.maxTurns);
    },
    sessionId: input.sessionId,
    convertToLlm,
    ...(input.hooks.transformContext ? { transformContext: input.hooks.transformContext } : {}),
    ...(input.modelInfo.getApiKey ? { getApiKey: input.modelInfo.getApiKey } : {}),
  };

  let finalMessages: AgentMessage[] = [];
  let finalText = '';
  let finalUsage: unknown;
  let terminalError: Error | undefined;
  const abortController = new AbortController();

  const emit = (event: AgentEvent) => {
    if (event.type !== 'agent_end') return;

    finalMessages = event.messages;
    finalUsage = extractUsage(finalMessages) ?? extractLastCallUsage(finalMessages);
    const errorReason = extractErrorStop(finalMessages);
    if (errorReason) {
      terminalError = new Error(`LLM call failed: ${errorReason}`);
      return;
    }
    finalText = extractAssistantText(finalMessages);
  };

  const returnedMessages = await withTimeout(
    runAgentLoop(
      [createUserMessage(input.userInput)],
      context,
      config,
      emit,
      abortController.signal,
      withStreamRetry(cachedStreamFn),
    ),
    input.timeoutMs,
    () => abortController.abort(),
  );
  if (finalMessages.length === 0) {
    finalMessages = returnedMessages;
    finalUsage = extractUsage(finalMessages) ?? extractLastCallUsage(finalMessages);
    const errorReason = extractErrorStop(finalMessages);
    if (errorReason) {
      terminalError = new Error(`LLM call failed: ${errorReason}`);
    } else {
      finalText = extractAssistantText(finalMessages);
    }
  }
  if (terminalError) throw terminalError;
  return {
    text: finalText,
    messages: finalMessages,
    usage: finalUsage,
  };
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

function createUserMessage(input: string): AgentMessage {
  return {
    role: 'user',
    content: [{ type: 'text', text: input }],
    timestamp: Date.now(),
  } as AgentMessage;
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
