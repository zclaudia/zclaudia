import type { JSX } from 'react';
import { Bell, Bug, Globe, Puzzle, Settings, ShieldCheck, Sparkles, Zap } from 'lucide-react';
import { isAndroid } from '../../utils/platform';

export type SettingsTab =
  | 'general'
  | 'agent'
  | 'permissions'
  | 'notifications'
  | 'gateway'
  | 'debug'
  | 'about'
  | `plugin:${string}`;

export interface SettingsTabDef {
  id: SettingsTab;
  label: string;
  icon: JSX.Element;
}

interface SettingsTabsOptions {
  isMobile: boolean;
  pluginSettingsTabs: { id: string; label: string }[];
}

/**
 * Single flat settings tab list. Settings always edit this device's local
 * backend, so the list is no longer split into "app" vs "active server"
 * groups. Platform conditions preserved from the previous split:
 * - Notifications tab is Android-only.
 * - The gateway tab renders the mobile gateway config on mobile; on desktop
 *   it is labeled "Connection" (id stays `gateway` for deep links).
 */
export function getSettingsTabs({
  isMobile,
  pluginSettingsTabs,
}: SettingsTabsOptions): SettingsTabDef[] {
  const android = isAndroid();
  return [
    {
      id: 'general',
      label: 'General',
      icon: <Settings className="w-4 h-4" strokeWidth={1.75} />,
    },
    ...(android
      ? [
          {
            id: 'notifications' as SettingsTab,
            label: 'Notifications',
            icon: <Bell className="w-4 h-4" strokeWidth={1.75} />,
          },
        ]
      : []),
    {
      id: 'agent',
      label: 'Claudia',
      icon: <Zap className="w-4 h-4" strokeWidth={1.75} />,
    },
    {
      id: 'permissions',
      label: 'Permissions',
      icon: <ShieldCheck className="w-4 h-4" strokeWidth={1.75} />,
    },
    ...pluginSettingsTabs.map(tab => ({
      id: `plugin:${tab.id}` as SettingsTab,
      label: tab.label,
      icon: <Puzzle className="w-4 h-4" strokeWidth={1.75} />,
    })),
    {
      id: 'gateway',
      label: isMobile ? 'Gateway' : 'Connection',
      icon: <Globe className="w-4 h-4" strokeWidth={1.75} />,
    },
    {
      id: 'debug',
      label: 'Debug',
      icon: <Bug className="w-4 h-4" strokeWidth={1.75} />,
    },
    {
      id: 'about',
      label: 'About',
      icon: <Sparkles className="w-4 h-4" strokeWidth={1.75} />,
    },
  ];
}
