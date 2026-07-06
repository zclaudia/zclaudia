import type { ReactNode } from 'react';
import { useTopLevelViewStore } from '../../stores/topLevelViewStore';
import { useServerStore } from '../../stores/serverStore';
import { useIsActiveLocalBackend } from '../../hooks/useIsActiveLocalBackend';
import { PluginSettings } from '../settings/PluginSettings';
import { WebSearchSettings } from '../settings/WebSearchSettings';
import { BuiltinPanelsSection } from './BuiltinPanelsSection';
import { BackendPicker } from './BackendPicker';
import type { PluginsTab } from './plugins-types';

const TITLES: Record<PluginsTab, string> = {
  installed: 'Plugins',
  builtin: 'Built-in',
  'web-search': 'Web Search',
};

function Shell({
  tab,
  showPicker,
  children,
}: {
  tab: PluginsTab;
  showPicker: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h1 className="truncate text-sm font-medium text-foreground">{TITLES[tab]}</h1>
        {showPicker && (
          <div className="w-56">
            <BackendPicker />
          </div>
        )}
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        <div className="mx-auto max-w-2xl">{children}</div>
      </div>
    </div>
  );
}

export function PluginsContent() {
  const view = useTopLevelViewStore(s => s.view);
  const activeServerId = useServerStore(s => s.activeServerId);
  const { isRemoteBackend } = useIsActiveLocalBackend();

  if (view.kind !== 'plugins') return null;
  const tab = view.tab;

  if (tab === 'builtin') {
    return (
      <Shell tab={tab} showPicker={false}>
        <BuiltinPanelsSection />
      </Shell>
    );
  }

  // Key the active-backend content on activeServerId so switching backends via
  // the header picker remounts it, forcing a refetch of that backend's config
  // (both components load once on mount).
  const backendKey = activeServerId ?? 'none';

  if (tab === 'web-search') {
    return (
      <Shell tab={tab} showPicker>
        <WebSearchSettings key={backendKey} readOnly={isRemoteBackend} />
      </Shell>
    );
  }

  return (
    <Shell tab={tab} showPicker>
      <PluginSettings key={backendKey} showBuiltin={false} />
    </Shell>
  );
}
