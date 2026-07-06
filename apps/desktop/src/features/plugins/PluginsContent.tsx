import type { ReactNode } from 'react';
import { useTopLevelViewStore } from '../../stores/topLevelViewStore';
import { useServerStore } from '../../stores/serverStore';
import { useFacadeStore } from '../../stores/facadeStore';
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
  const facadeBackends = useFacadeStore(s => s.backends);
  const localBackendId = useFacadeStore(s => s.localBackendId);

  if (view.kind !== 'plugins') return null;
  const tab = view.tab;

  const activeServer = facadeBackends.find(b => b.backendId === activeServerId) ?? null;
  const isActiveLocalBackend =
    !!activeServerId &&
    (activeServerId === localBackendId || activeServer?.isThisInstance === true);
  const isRemoteBackend = !isActiveLocalBackend;

  if (tab === 'builtin') {
    return (
      <Shell tab={tab} showPicker={false}>
        <BuiltinPanelsSection />
      </Shell>
    );
  }

  if (tab === 'web-search') {
    return (
      <Shell tab={tab} showPicker>
        <WebSearchSettings readOnly={isRemoteBackend} />
      </Shell>
    );
  }

  return (
    <Shell tab={tab} showPicker>
      <PluginSettings showBuiltin={false} />
    </Shell>
  );
}
