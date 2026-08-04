import type { PluginCardModel } from '../plugins-types';
import { Badge } from '../../../components/ui/Badge';
import { Toggle } from '../../../components/ui/Toggle';

export function PluginCard({
  model,
  kind,
  onToggle,
}: {
  model: PluginCardModel;
  kind: 'Built-in' | 'Installed';
  onToggle: () => void;
}) {
  const Icon = model.icon;
  const statusLabel =
    model.status === 'error'
      ? 'Error'
      : model.enabled
        ? 'Active'
        : kind === 'Installed'
          ? 'Installed'
          : 'Disabled';
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border/60 bg-secondary/30 p-3 text-left">
      <div className="flex flex-wrap items-center justify-between gap-1">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-4 w-4" strokeWidth={1.75} />
        </span>
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-1">
          {model.source && (
            <Badge label={model.source === 'managed' ? 'Managed' : 'Development'} tone="neutral" />
          )}
          <Badge label={kind} tone={kind === 'Built-in' ? 'accent' : 'neutral'} />
        </div>
      </div>
      {model.onOpen ? (
        <button
          type="button"
          onClick={model.onOpen}
          className="text-left"
          aria-label={`Open ${model.title}`}
        >
          <div className="text-sm font-medium text-foreground">{model.title}</div>
          <div className="truncate font-mono text-[11px] text-muted-foreground">
            {model.pluginId}
          </div>
          {model.version && (
            <div className="mt-1 text-[11px] text-muted-foreground">v{model.version}</div>
          )}
        </button>
      ) : (
        <div>
          <div className="text-sm font-medium text-foreground">{model.title}</div>
          <div className="truncate font-mono text-[11px] text-muted-foreground">
            {model.pluginId}
          </div>
          {model.version && (
            <div className="mt-1 text-[11px] text-muted-foreground">v{model.version}</div>
          )}
        </div>
      )}
      {model.description && (
        <p className="line-clamp-2 min-h-8 text-[11px] leading-4 text-muted-foreground">
          {model.description}
        </p>
      )}
      {model.missingRequirements && model.missingRequirements.length > 0 && (
        <p className="truncate text-[11px] text-amber-600 dark:text-amber-400">
          Missing: {model.missingRequirements.join(', ')}
        </p>
      )}
      {model.error && <p className="line-clamp-2 text-[11px] text-destructive">{model.error}</p>}
      <div className="mt-0.5 flex items-center justify-between">
        <Badge label={statusLabel} tone={model.enabled ? 'accent' : 'neutral'} />
        <Toggle
          checked={model.enabled}
          onChange={onToggle}
          aria-label={`${model.enabled ? 'Disable' : 'Enable'} ${model.title}`}
        />
      </div>
    </div>
  );
}
