import type { ModeConfig } from '../../helpers/modes';

/**
 * Gateway Backend 2 Configuration
 * Example: Staging gateway backend or alternative gateway server
 */
export const gateway2Mode: ModeConfig = {
  id: 'gateway2',
  name: 'Gateway Backend 2',
  enabled: !!process.env.GATEWAY2_SECRET,  // Only enabled if configured
  serverAddress: process.env.GATEWAY2_URL || 'localhost:3201',  // Different port
  requiresAuth: true,
  gatewayUrl: process.env.GATEWAY2_URL || 'ws://localhost:3201',
  gatewaySecret: process.env.GATEWAY2_SECRET || '',
  backendId: process.env.GATEWAY2_BACKEND_ID,  // Can be pre-configured
  apiKey: process.env.GATEWAY2_API_KEY || '',

  // Optional proxy configuration (can use different proxy)
  proxyUrl: process.env.GATEWAY2_PROXY_URL,
  proxyAuth: process.env.GATEWAY2_PROXY_USER ? {
    username: process.env.GATEWAY2_PROXY_USER,
    password: process.env.GATEWAY2_PROXY_PASS || ''
  } : undefined,
};
