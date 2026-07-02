// Plugin protocol messages

import type { CapabilityNegotiationResult, PluginRequirements } from '../../plugin-types.js';

// Plugin state (Server → Client)
export interface PluginStateMessage {
  type: 'plugin_state';
  plugins: Array<{
    id: string;
    name: string;
    version: string;
    description: string;
    status: 'active' | 'inactive' | 'error';
    enabled: boolean;
    error?: string;
    permissions?: string[];
    grantedPermissions?: string[];
    tools?: string[];
    commands?: string[];
    path: string;
    /** Effective platform scope: 'universal' (backend-only) or 'desktop' (has UI) */
    platform: 'universal' | 'desktop';
    /** Capability requirements declared in manifest */
    requires?: PluginRequirements;
    /** Result of capability negotiation */
    capabilities?: CapabilityNegotiationResult;
  }>;
}

// Plugin notification (Server → Client)
export interface PluginNotificationMessage {
  type: 'plugin_notification';
  pluginId: string;
  title: string;
  body: string;
  /** Target plugin notch tab ID (namespaced as 'pluginId/tabId') */
  notchTab?: string;
}

// Plugin show panel (Server → Client)
export interface PluginShowPanelMessage {
  type: 'plugin_show_panel';
  pluginId: string;
  panelId: string;
}

// Plugin panel registered (Server → Client) — sent when a plugin activates with panels
export interface PluginPanelRegisteredMessage {
  type: 'plugin_panel_registered';
  panelId: string;
  pluginId: string;
  label: string;
  icon?: string;
  iframeUrl?: string;
  order?: number;
}

// Plugin panel unregistered (Server → Client) — sent when a plugin deactivates
export interface PluginPanelUnregisteredMessage {
  type: 'plugin_panel_unregistered';
  pluginId: string;
}

// Plugin notch tab registered (Server → Client) — sent when a plugin activates with notchTabs
export interface PluginNotchTabRegisteredMessage {
  type: 'plugin_notch_tab_registered';
  tabId: string;
  pluginId: string;
  label: string;
  icon?: string;
  order?: number;
}

// Plugin notch tab unregistered (Server → Client) — sent when a plugin deactivates
export interface PluginNotchTabUnregisteredMessage {
  type: 'plugin_notch_tab_unregistered';
  pluginId: string;
}

// Agent profiles changed (Server -> Client) - sent when plugin-contributed profiles are installed.
export interface AgentProfilesChangedMessage {
  type: 'agent_profiles_changed';
}

// File Push notification (Server → Client)
export interface FilePushNotificationMessage {
  type: 'file_push';
  fileId: string;
  sessionId: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  description?: string;
  autoDownload: boolean;
  messageId?: string;
}

export type PluginsClientMessage = never;

export type PluginsServerMessage =
  | PluginStateMessage
  | PluginNotificationMessage
  | PluginShowPanelMessage
  | PluginPanelRegisteredMessage
  | PluginPanelUnregisteredMessage
  | PluginNotchTabRegisteredMessage
  | PluginNotchTabUnregisteredMessage
  | AgentProfilesChangedMessage
  | FilePushNotificationMessage;
