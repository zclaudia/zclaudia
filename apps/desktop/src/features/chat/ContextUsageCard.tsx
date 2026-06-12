import { Gauge } from 'lucide-react';
import type { ContextUsagePayload } from '@zclaudia/shared';

interface ContextUsageCardProps {
  usage: ContextUsagePayload;
}

export function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return String(tokens);
}

const SOURCE_LABELS: Record<string, string> = {
  profile_entry: 'context window from LLM profile',
  pi_ai_registry: 'context window from model registry',
  openai_compat_default: 'context window assumed (openai-compat default)',
  fallback: 'context window unknown — fallback estimate',
};

/**
 * Inline card for the /context command. Rendered when MessageList encounters
 * a synthetic system message whose `metadata.contextUsage` is set (frontend
 * only, never persisted). Shows total occupancy from real usage plus a
 * chars/4-estimated per-category breakdown.
 */
export function ContextUsageCard({ usage }: ContextUsageCardProps) {
  const { contextWindow, usedTokens, breakdown } = usage;
  const usedPercent = contextWindow > 0 ? (usedTokens / contextWindow) * 100 : 0;

  const rows = [
    { key: 'system-prompt', label: 'System prompt', tokens: breakdown.systemPrompt.tokens, estimated: true, color: 'bg-blue-500' },
    { key: 'tools', label: `Tools (${breakdown.tools.count})`, tokens: breakdown.tools.tokens, estimated: true, color: 'bg-violet-500' },
    { key: 'skills', label: 'Skills', tokens: breakdown.skills.tokens, estimated: true, color: 'bg-amber-500' },
    { key: 'messages', label: 'Messages', tokens: breakdown.messages.tokens, estimated: true, color: 'bg-emerald-500' },
    { key: 'free-space', label: 'Free space', tokens: breakdown.freeSpace.tokens, estimated: false, color: 'bg-muted' },
  ];

  const segmentPercent = (tokens: number) =>
    contextWindow > 0 ? Math.max(0, Math.min(100, (tokens / contextWindow) * 100)) : 0;

  return (
    <div
      data-testid="context-usage-card"
      className="my-3 rounded-lg border border-border/60 bg-secondary/30 text-xs px-3 py-2.5 space-y-2"
    >
      <div className="flex items-center gap-2">
        <Gauge size={14} strokeWidth={1.5} className="flex-shrink-0 text-muted-foreground" />
        <span className="font-medium tracking-wide uppercase text-[10px] text-muted-foreground">
          Context window
        </span>
        <span className="ml-auto text-muted-foreground">
          {`${formatTokenCount(usedTokens)} / ${formatTokenCount(contextWindow)} (${usedPercent.toFixed(1)}%)`}
        </span>
      </div>

      <div className="flex h-2 w-full overflow-hidden rounded-full bg-background/60">
        {rows.filter((r) => r.key !== 'free-space').map((row) => (
          <div
            key={row.key}
            data-testid={`context-segment-${row.key}`}
            className={row.color}
            style={{ width: `${segmentPercent(row.tokens)}%` }}
          />
        ))}
      </div>

      <ul className="space-y-1">
        {rows.map((row) => (
          <li key={row.key} className="flex items-center gap-2">
            <span className={`inline-block h-2 w-2 rounded-sm flex-shrink-0 ${row.color}`} />
            <span className="text-foreground/90">{row.label}</span>
            <span className="ml-auto font-mono text-muted-foreground">
              {row.estimated ? `~${formatTokenCount(row.tokens)}` : formatTokenCount(row.tokens)}
            </span>
            <span className="w-12 text-right font-mono text-muted-foreground/70">
              {`${segmentPercent(row.tokens).toFixed(1)}%`}
            </span>
          </li>
        ))}
      </ul>

      <div className="border-t border-border/40 pt-1.5 text-[10px] text-muted-foreground/80 space-y-0.5">
        <div>
          Breakdown values are chars/4 estimates; the total comes from real usage.
          {' '}({SOURCE_LABELS[usage.contextWindowSource] ?? usage.contextWindowSource})
        </div>
        {breakdown.messages.clamped && (
          <div>Note: category estimates exceeded real usage; Messages clamped to 0.</div>
        )}
        {!usage.usedTokensFromUsage && (
          <div>Note: no completed run yet — the total is itself an estimate.</div>
        )}
      </div>
    </div>
  );
}
