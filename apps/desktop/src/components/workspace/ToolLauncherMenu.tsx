import { usePluginStore, selectPluginPanels } from '../../stores/pluginStore';
import { openToolInWorkspace } from '../../utils/workspaceActions';
import { useServerStore } from '../../stores/serverStore';

interface Props { sessionId: string; projectId?: string; onPick: () => void; }

export function ToolLauncherMenu({ sessionId, projectId, onPick }: Props) {
  const panels = usePluginStore(selectPluginPanels);
  const disabled = usePluginStore((s) => s.disabledBuiltinPanels);
  const backendId = useServerStore((s) => s.activeServerId);
  const tools = panels.filter(
    (p) => (p.platforms ?? ['desktop']).includes('desktop') && !disabled.includes(p.id),
  );
  return (
    <div className="absolute right-0 top-full mt-1 z-30 min-w-40 rounded-md border border-border bg-popover py-1 shadow-md">
      {tools.map((t) => (
        <button
          key={t.id}
          onClick={() => { openToolInWorkspace(sessionId, t.id, { projectId, backendId }); onPick(); }}
          className="flex w-full items-center px-3 py-1.5 text-left text-xs text-foreground hover:bg-secondary"
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
