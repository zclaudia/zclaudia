import { useState } from 'react';
import { IconButton } from '../../components/ui/Button';
import { Tooltip } from '../../components/ui/Tooltip';
import { Play, Pause, Trash2, Shield, Loader2 } from 'lucide-react';
import type { AutomationItem } from './automation-types';
import { ListCard, StatusDot, ToneBadge, MetaSep } from './AutomationSharedComponents';
import { ScopeChunk } from './AutomationScope';
import type { Tone } from '../../components/ui/tone';

export function AutomationCard({
  item,
  scopeLabel,
  runPending,
  togglePending,
  deletePending,
  onToggle,
  onTrigger,
  onDelete,
}: {
  item: AutomationItem;
  scopeLabel: string;
  runPending: boolean;
  togglePending: boolean;
  deletePending: boolean;
  onToggle: () => void;
  onTrigger: () => void;
  onDelete: () => void;
}) {
  const tone: Tone =
    item.status === 'running'
      ? 'warning'
      : item.status === 'error'
        ? 'destructive'
        : item.enabled
          ? 'success'
          : 'neutral';
  // Long names only differ at the tail ("…场景甲" / "…场景乙"); tap the name
  // to unfold the full text on both pointer and touch.
  const [nameExpanded, setNameExpanded] = useState(false);
  return (
    <ListCard
      data-automation-card
      muted={!item.enabled}
      lead={<StatusDot tone={tone} pulse={item.status === 'running'} />}
      title={
        <button
          type="button"
          onClick={() => setNameExpanded(v => !v)}
          aria-expanded={nameExpanded}
          className="min-w-0 rounded-xs text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {item.name}
        </button>
      }
      titleExpanded={nameExpanded}
      titleExtra={item.isSystem ? <ToneBadge tone="neutral">System</ToneBadge> : undefined}
      meta={
        <>
          <ScopeChunk projectId={item.projectId} label={scopeLabel} />
          <MetaSep />
          <span className="min-w-0 truncate">{item.triggerSummary}</span>
          <MetaSep />
          <span className="min-w-0 truncate">{item.actionSummary}</span>
          {item.runCount > 0 && (
            <>
              <MetaSep />
              <span className="tabular-nums">
                {item.runCount} run{item.runCount !== 1 ? 's' : ''}
              </span>
            </>
          )}
          {item.lastError && (
            <>
              <MetaSep />
              <Tooltip content={item.lastError}>
                <span className="max-w-[10rem] truncate text-destructive">{item.lastError}</span>
              </Tooltip>
            </>
          )}
        </>
      }
      trail={
        item.isSystem ? (
          // System automations are immutable server-side; offering Run/Disable/
          // Delete here invited taps that could only fail.
          <Tooltip content="System automation — managed by the app and read-only">
            <span className="inline-flex items-center gap-1 px-1.5 text-xs text-muted-foreground">
              <Shield size={12} strokeWidth={1.75} aria-hidden />
              Read-only
            </span>
          </Tooltip>
        ) : (
          <>
            <Tooltip content="Run now">
              <IconButton onClick={onTrigger} aria-label="Run now" disabled={runPending}>
                {runPending ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
              </IconButton>
            </Tooltip>
            <Tooltip content={item.enabled ? 'Disable' : 'Enable'}>
              <IconButton
                onClick={onToggle}
                aria-label={item.enabled ? 'Disable' : 'Enable'}
                disabled={togglePending}
              >
                {togglePending ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : item.enabled ? (
                  <Pause size={12} />
                ) : (
                  <Play size={12} />
                )}
              </IconButton>
            </Tooltip>
            <Tooltip content="Delete">
              <IconButton
                onClick={onDelete}
                aria-label="Delete"
                disabled={deletePending}
                className="hover:text-destructive"
              >
                {deletePending ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Trash2 size={12} />
                )}
              </IconButton>
            </Tooltip>
          </>
        )
      }
    />
  );
}
