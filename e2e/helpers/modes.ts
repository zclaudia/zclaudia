export interface ModeConfig {
  id: string;  // Changed: Allow any string ID to support multiple gateway backends
  name: string;
  enabled: boolean;  // Can skip modes if not available in environment

  // Server connection details
  serverAddress: string;
  requiresAuth: boolean;
  apiKey?: string;

  // Gateway-specific
  gatewayUrl?: string;
  gatewaySecret?: string;
  backendId?: string;

  // Proxy (Gateway only)
  proxyUrl?: string;
  proxyAuth?: {
    username: string;
    password: string;
  };

  // Environment requirements
  envVars?: Record<string, string>;
}

// Removed strict ModesConfig interface to allow dynamic mode registration

import { localMode } from '../fixtures/modes/local.config';
import { remoteMode } from '../fixtures/modes/remote.config';
import { gatewayMode } from '../fixtures/modes/gateway.config';

// Changed: Use Record to support dynamic mode registration
export const ALL_MODES: Record<string, ModeConfig> = {
  local: localMode,
  remote: remoteMode,
  gateway: gatewayMode,
};

/**
 * Register a new mode dynamically
 * Useful for adding multiple gateway backends or custom modes
 */
export function registerMode(mode: ModeConfig): void {
  if (ALL_MODES[mode.id]) {
    console.warn(`Mode "${mode.id}" already exists, overwriting...`);
  }
  ALL_MODES[mode.id] = mode;
}

// Get only enabled modes
export function getEnabledModes(): ModeConfig[] {
  return Object.values(ALL_MODES).filter(mode => mode.enabled);
}

// Get mode by ID
export function getMode(id: string): ModeConfig {
  const mode = ALL_MODES[id as keyof typeof ALL_MODES];
  if (!mode) {
    throw new Error(`Unknown mode: ${id}`);
  }
  return mode;
}
