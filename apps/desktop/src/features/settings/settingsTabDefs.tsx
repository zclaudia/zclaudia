import type { JSX } from 'react';
import { Bell, Bug, Globe, Info, Puzzle, Settings, ShieldCheck, Zap } from 'lucide-react';
import { isAndroid } from '../../utils/platform';
import { SETTINGS_SURFACES, isVisibleOnSurface, type SettingsSurfaceId } from './settingsSurface';

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
 *
 * Which tabs exist per viewport comes from `SETTINGS_SURFACES`; the order does
 * not, because it is a ranking rather than a yes/no. On a phone the gateway
 * connection is the first thing you configure and the first thing you revisit
 * when the app goes quiet, so it sits directly under General instead of sixth.
 */
export function getSettingsTabs({
  isMobile,
  pluginSettingsTabs,
}: SettingsTabsOptions): SettingsTabDef[] {
  const android = isAndroid();

  const general: SettingsTabDef = {
    id: 'general',
    label: 'General',
    icon: <Settings className="w-4 h-4" strokeWidth={1.75} />,
  };
  const notifications: SettingsTabDef = {
    id: 'notifications',
    label: 'Notifications',
    icon: <Bell className="w-4 h-4" strokeWidth={1.75} />,
  };
  const gateway: SettingsTabDef = {
    id: 'gateway',
    label: isMobile ? 'Gateway' : 'Connection',
    icon: <Globe className="w-4 h-4" strokeWidth={1.75} />,
  };
  const middle: SettingsTabDef[] = [
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
  ];
  const tail: SettingsTabDef[] = [
    {
      id: 'debug',
      label: 'Debug',
      icon: <Bug className="w-4 h-4" strokeWidth={1.75} />,
    },
    {
      id: 'about',
      label: 'About',
      icon: <Info className="w-4 h-4" strokeWidth={1.75} />,
    },
  ];

  const ordered = isMobile
    ? [general, gateway, ...(android ? [notifications] : []), ...middle, ...tail]
    : [general, ...(android ? [notifications] : []), ...middle, gateway, ...tail];

  return ordered.filter(tab => {
    const id = `tab.${tab.id}`;
    // Plugin tabs are contributed at runtime, and Notifications is gated on
    // platform (Android) rather than viewport — neither has a table entry.
    if (!(id in SETTINGS_SURFACES)) return true;
    return isVisibleOnSurface(id as SettingsSurfaceId, isMobile);
  });
}
