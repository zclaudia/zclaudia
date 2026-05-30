import type { ModeConfig } from '../../helpers/modes';

/**
 * Gateway Backend 1 Configuration
 * Example: Production gateway backend
 */
export const gateway1Mode: ModeConfig = {
  id: 'gateway1',
  name: 'Gateway Backend 1',
  enabled: !!process.env.GATEWAY1_SECRET,  // Only enabled if configured
  serverAddress: process.env.GATEWAY1_URL || 'localhost:3200',
  requiresAuth: true,
  gatewayUrl: process.env.GATEWAY1_URL || 'ws://localhost:3200',
  gatewaySecret: process.env.GATEWAY1_SECRET || '',
  backendId: process.env.GATEWAY1_BACKEND_ID,  // Can be pre-configured
  apiKey: process.env.GATEWAY1_API_KEY || '',

  // Optional proxy configuration
  proxyUrl: process.env.GATEWAY1_PROXY_URL,
  proxyAuth: process.env.GATEWAY1_PROXY_USER ? {
    username: process.env.GATEWAY1_PROXY_USER,
    password: process.env.GATEWAY1_PROXY_PASS || ''
  } : undefined,
};
