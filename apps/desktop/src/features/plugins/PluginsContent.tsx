import { useEffect, useMemo, useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import {
  Terminal,
  FileText,
  Pencil,
  GitCompare,
  Brain,
  Bell,
  GitBranch,
  GitMerge,
  Blocks,
  type LucideIcon,
} from 'lucide-react';
import { useTopLevelViewStore } from '../../stores/topLevelViewStore';
import { usePluginStore, selectPluginPanels } from '../../stores/pluginStore';
import { getBaseUrl, fetchAndSyncPlugins } from '../../services/api';
import { Modal } from '../../components/ui/Modal';
import { WebSearchSettings } from '../settings/WebSearchSettings';
import { PluginDirsManager } from './PluginDirsManager';
import { PluginsBrowseView } from './PluginsBrowseView';
import type { PluginCardModel } from './plugins-types';

const BUILTIN_ICONS: Record<string, LucideIcon> = {
  'com.claudia.terminal': Terminal,
  'com.claudia.file-viewer': FileText,
  'com.claudia.draft': Pencil,
  'com.claudia.changes': GitCompare,
  'com.claudia.memory': Brain,
  'com.claudia.notifications': Bell,
  'com.claudia.lineage': GitBranch,
  'com.zclaudia.git': GitMerge,
};

function Shell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <h1 className="truncate text-sm font-medium text-foreground">{title}</h1>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        <div className="mx-auto max-w-2xl">{children}</div>
      </div>
    </div>
  );
}

export function PluginsContent() {
  const view = useTopLevelViewStore(s => s.view);

  const plugins = usePluginStore(s => s.plugins);
  const setError = usePluginStore(s => s.setError);
  const disabledBuiltinPanels = usePluginStore(s => s.disabledBuiltinPanels);
  const toggleBuiltinPanel = usePluginStore(s => s.toggleBuiltinPanel);
  const panels = usePluginStore(selectPluginPanels);

  const [dirsOpen, setDirsOpen] = useState(false);

  useEffect(() => {
    fetchAndSyncPlugins().catch(() => {});
  }, []);

  const builtinModels: PluginCardModel[] = useMemo(
    () =>
      panels
        .filter(p => p.builtin)
        .map(p => ({
          id: p.id,
          title: p.label,
          pluginId: p.pluginId,
          icon: BUILTIN_ICONS[p.pluginId] ?? Blocks,
          enabled: !disabledBuiltinPanels.includes(p.id),
        })),
    [panels, disabledBuiltinPanels]
  );

  const installedModels: PluginCardModel[] = useMemo(
    () =>
      plugins.map(p => ({
        id: p.manifest.id,
        title: p.manifest.name,
        pluginId: p.manifest.id,
        icon: Blocks,
        enabled: p.enabled && p.status === 'active',
      })),
    [plugins]
  );

  const toggleInstalled = useCallback(
    async (pluginId: string) => {
      const plugin = plugins.find(p => p.manifest.id === pluginId);
      if (!plugin) return;
      const action = plugin.status === 'active' ? 'deactivate' : 'activate';
      try {
        const res = await fetch(
          `${getBaseUrl()}/api/plugins/${encodeURIComponent(pluginId)}/${action}`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' } }
        );
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setError(data.error?.message || `Failed to ${action} plugin`);
        } else {
          await fetchAndSyncPlugins();
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to toggle plugin');
      }
    },
    [plugins, setError]
  );

  if (view.kind !== 'plugins') return null;

  if (view.tab === 'web-search') {
    return (
      <Shell title="Web Search">
        <WebSearchSettings />
      </Shell>
    );
  }

  return (
    <>
      <PluginsBrowseView
        builtin={builtinModels}
        installed={installedModels}
        onToggleBuiltin={toggleBuiltinPanel}
        onToggleInstalled={toggleInstalled}
        onAddDirectory={() => setDirsOpen(true)}
      />
      <Modal
        open={dirsOpen}
        onClose={() => setDirsOpen(false)}
        ariaLabel="Plugin directories"
        title="Plugin directories"
        size="lg"
      >
        <div className="p-4">
          <PluginDirsManager embedded />
        </div>
      </Modal>
    </>
  );
}
