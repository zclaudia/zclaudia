/**
 * Built-in Panels Section
 *
 * Standalone management list for built-in panels, extracted from PluginSettings
 * so it can be rendered on its own (e.g. by the Plugins mode's "Built-in" sub-tab).
 */

import { usePluginStore, selectPluginPanels } from '../../stores/pluginStore';
import type { UIExtension } from '../../stores/pluginStore';
import { Toggle } from '../../components/ui/Toggle';

// Built-in panel toggle card. Moved verbatim from PluginSettings.
interface BuiltinPanelCardProps {
  panel: UIExtension;
  disabled: boolean;
  onToggle: (panelId: string) => void;
}

function BuiltinPanelCard({ panel, disabled, onToggle }: BuiltinPanelCardProps) {
  return (
    <div className="p-3 bg-secondary/50 rounded-lg border border-border/50 hover:border-border transition-colors">
      <div className="flex items-center justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm">{panel.label}</span>
            <span
              className={`px-1.5 py-0.5 rounded-md text-xs font-medium ${
                disabled
                  ? 'bg-muted-foreground/20 text-muted-foreground'
                  : 'bg-success/20 text-success'
              }`}
            >
              {disabled ? 'Disabled' : 'Active'}
            </span>
          </div>
          <p className="text-xs text-muted-foreground/70 font-mono mt-0.5">{panel.pluginId}</p>
        </div>
        <Toggle
          checked={!disabled}
          onChange={() => onToggle(panel.id)}
          aria-label={disabled ? 'Enable panel' : 'Disable panel'}
        />
      </div>
    </div>
  );
}

/**
 * Built-in panels management list. Built-in panels self-identify via the
 * `builtin` flag set at registration in builtinPanels.ts, so newly-added tools
 * appear here automatically. Returns null when there are no built-in panels.
 */
export function BuiltinPanelsSection() {
  const disabledBuiltinPanels = usePluginStore(s => s.disabledBuiltinPanels);
  const toggleBuiltinPanel = usePluginStore(s => s.toggleBuiltinPanel);
  const allPanels = usePluginStore(selectPluginPanels);
  const builtinPanels = allPanels.filter(p => p.builtin);

  if (builtinPanels.length === 0) return null;

  return (
    <div>
      <h4 className="text-xs font-medium text-muted-foreground tracking-wider mb-2">
        Built-in ({builtinPanels.length})
      </h4>
      <div className="space-y-2">
        {builtinPanels.map(panel => (
          <BuiltinPanelCard
            key={panel.id}
            panel={panel}
            disabled={disabledBuiltinPanels.includes(panel.id)}
            onToggle={toggleBuiltinPanel}
          />
        ))}
      </div>
    </div>
  );
}
