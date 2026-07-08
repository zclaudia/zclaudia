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
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border/60 bg-secondary/30 p-3 text-left">
      <div className="flex items-center justify-between">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-4 w-4" strokeWidth={1.75} />
        </span>
        <Badge label={kind} tone={kind === 'Built-in' ? 'accent' : 'neutral'} />
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
        </button>
      ) : (
        <div>
          <div className="text-sm font-medium text-foreground">{model.title}</div>
          <div className="truncate font-mono text-[11px] text-muted-foreground">
            {model.pluginId}
          </div>
        </div>
      )}
      <div className="mt-0.5 flex items-center justify-between">
        <Badge label={model.enabled ? 'Active' : 'Disabled'} tone={model.enabled ? 'accent' : 'neutral'} />
        <Toggle
          checked={model.enabled}
          onChange={onToggle}
          aria-label={`${model.enabled ? 'Disable' : 'Enable'} ${model.title}`}
        />
      </div>
    </div>
  );
}
