import type { Permission, PluginPlatform } from '@zclaudia/shared';
import { apiCall } from './unwrap';
import { usePluginStore } from '../../stores/pluginStore';
import type { InstalledPlugin } from '../../stores/pluginStore';

interface PluginData {
  id: string;
  name: string;
  version: string;
  description: string;
  permissions?: string[];
  platform?: string;
  status: string;
  enabled: boolean;
  error?: string;
  path: string;
  source?: 'managed' | 'development';
  installedAt?: string;
  updatedAt?: string;
  activeVersion?: string;
  availableVersions?: string[];
  canRollback?: boolean;
  requirements?: Array<{
    name: string;
    found: boolean;
    path?: string;
    source: 'manifest' | 'official';
  }>;
  panels?: Array<{
    id: string;
    label: string;
    icon?: string;
    iframeUrl?: string;
    order?: number;
  }>;
}

/**
 * Fetch plugins from the server and sync to pluginStore.
 * This is the primary mechanism for populating plugin state.
 */
export async function fetchAndSyncPlugins(options?: RequestInit): Promise<void> {
  const plugins = await apiCall<PluginData[]>('/api/plugins', options);
  const pluginStore = usePluginStore.getState();
  const now = new Date().toISOString();

  const mapped: InstalledPlugin[] = plugins.map(p => {
    const previous = pluginStore.plugins.find(item => item.manifest.id === p.id);
    return {
      manifest: {
        id: p.id,
        name: p.name,
        version: p.version,
        description: p.description,
        permissions: p.permissions as Permission[] | undefined,
        platform: p.platform as PluginPlatform | undefined,
      },
      path: p.path,
      status: p.status === 'active' ? 'active' : p.status === 'error' ? 'error' : 'idle',
      enabled: p.enabled,
      error: p.error,
      installedAt: p.installedAt ?? previous?.installedAt ?? now,
      updatedAt: p.updatedAt ?? previous?.updatedAt ?? now,
      source: p.source ?? 'development',
      activeVersion: p.activeVersion,
      availableVersions: p.availableVersions ?? [],
      canRollback: p.canRollback ?? false,
      requirements: p.requirements ?? [],
    };
  });

  pluginStore.setPlugins(mapped);

  // Register panels from active plugins
  for (const p of plugins) {
    if (p.status === 'active' && p.panels?.length) {
      for (const panel of p.panels) {
        const existing = pluginStore.panels.find(ep => ep.id === panel.id);
        if (!existing) {
          pluginStore.registerPanel({
            id: panel.id,
            pluginId: p.id,
            type: 'panel',
            label: panel.label,
            icon: panel.icon,
            iframeUrl: panel.iframeUrl,
            order: panel.order,
            visible: false,
          });
        }
      }
    }
  }
}
