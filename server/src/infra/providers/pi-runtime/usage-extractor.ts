import type { Usage } from '@earendil-works/pi-ai';
import type { AgentMessage } from '@earendil-works/pi-agent-core';

export function zeroUsage(): Usage {
  return {
    input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

/**
 * Find the LLM-level error swallowed by pi-agent-core's run loop.
 *
 * Pi-agent-core treats `done` and `error` stream stop reasons identically:
 * both go through the same `message_end` path, dropping the error detail and
 * leaving only an empty assistant message with `stopReason: 'error'`.
 */
export function extractErrorStop(messages: AgentMessage[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as { role?: string; stopReason?: string; errorMessage?: string };
    if (m.role !== 'assistant') continue;
    return m.stopReason === 'error'
      ? (m.errorMessage || 'LLM provider returned an error stop reason')
      : undefined;
  }
  return undefined;
}

/**
 * Usage of the LAST assistant message that carries a usage block.
 *
 * Context-window occupancy is a point-in-time property of the final LLM call
 * in a turn (its input + cacheRead IS the occupied window).
 */
export function extractLastCallUsage(messages: AgentMessage[]): Partial<Usage> | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i] as { role?: string; usage?: Partial<Usage> };
    if (msg.role === 'assistant' && msg.usage) return msg.usage;
  }
  return undefined;
}

/**
 * Sum usage across all assistant messages in an `agent_end` payload.
 *
 * A tool-using turn yields multiple assistant messages (one per LLM call); each carries
 * its own usage block. We sum them so the final `result` event reflects the full turn cost,
 * not just the last LLM call.
 */
export function extractUsage(messages: AgentMessage[]): Usage {
  const acc = zeroUsage();
  for (const m of messages) {
    const msg = m as { role?: string; usage?: Partial<Usage> & { cost?: Partial<Usage['cost']> } };
    if (msg.role === 'assistant' && msg.usage) {
      acc.input += msg.usage.input ?? 0;
      acc.output += msg.usage.output ?? 0;
      acc.cacheRead += msg.usage.cacheRead ?? 0;
      acc.cacheWrite += msg.usage.cacheWrite ?? 0;
      acc.totalTokens += msg.usage.totalTokens ?? 0;
      if (msg.usage.cost) {
        acc.cost.input += msg.usage.cost.input ?? 0;
        acc.cost.output += msg.usage.cost.output ?? 0;
        acc.cost.cacheRead += msg.usage.cost.cacheRead ?? 0;
        acc.cost.cacheWrite += msg.usage.cost.cacheWrite ?? 0;
        acc.cost.total += msg.usage.cost.total ?? 0;
      }
    }
  }
  return acc;
}
