import type { LucideIcon } from 'lucide-react';

/** Sub-tabs inside the Plugins shell mode. */
export type PluginsTab = 'plugins' | 'web-search';

/** Maps any legacy/deep-link tab string onto a current tab. */
export function normalizePluginsTab(tab: string | undefined): PluginsTab {
  return tab === 'web-search' ? 'web-search' : 'plugins';
}

/** Presentational data for a single plugin card. */
export interface PluginCardModel {
  /** Toggle key + React key: panel.id for built-ins, manifest.id for installed. */
  id: string;
  title: string;
  /** Shown in mono under the title. */
  pluginId: string;
  icon: LucideIcon;
  enabled: boolean;
  /** Optional detail action (e.g. installed plugin settings). */
  onOpen?: () => void;
}
