import type { Usage } from '@earendil-works/pi-ai';
import type { AgentEvent } from '@earendil-works/pi-agent-core';
import type { ProviderRuntimeEvent } from '../types.js';
import { zeroUsage } from './usage-extractor.js';

export interface TranslateContext {
  sessionId: string;
  model: string;
  cwd: string;
  permissionMode?: string;
}

export function translateEvent(
  event: AgentEvent,
  _ctx: TranslateContext,
  usage?: Usage,
): ProviderRuntimeEvent | undefined {
  try {
    switch (event.type) {
      // agent_start is intentionally not translated; adapter.run emits `init`
      // directly as a run-bootstrap concern.
      case 'message_update': {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sub = (event as any).assistantMessageEvent;
        if (!sub) return undefined;
        if (sub.type === 'text_delta' && typeof sub.delta === 'string') {
          return { type: 'assistant', content: sub.delta };
        }
        if (sub.type === 'thinking_delta' && typeof sub.delta === 'string') {
          return { type: 'thinking_delta', thinkingContent: sub.delta };
        }
        if (sub.type === 'thinking_end') {
          // Extract thinkingSignature from the partial.content (set by pi when thinking completes)
          const blocks = sub.partial?.content;
          if (Array.isArray(blocks) && typeof sub.contentIndex === 'number') {
            const block = blocks[sub.contentIndex];
            if (block && block.type === 'thinking' && typeof block.thinkingSignature === 'string') {
              return { type: 'thinking_delta', thinkingSignature: block.thinkingSignature };
            }
          }
          return undefined;
        }
        return undefined;
      }
      case 'agent_end':
        return {
          type: 'result',
          isComplete: true,
          usage: usage ?? zeroUsage(),
        };
      // Explicit no-ops:
      case 'message_start':
      case 'message_end':
      case 'turn_start':
      case 'turn_end':
      case 'tool_execution_start':
      case 'tool_execution_update':
      case 'tool_execution_end':
        return undefined;
      default:
        return undefined;
    }
  } catch (err) {
    console.warn('[message-event-translator] translateEvent failed:', err);
    return undefined;
  }
}
