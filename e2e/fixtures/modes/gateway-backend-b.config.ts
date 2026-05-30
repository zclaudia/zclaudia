import type { ModeConfig } from '../../helpers/modes';

/**
 * Gateway Backend B Configuration
 * Same gateway server, different backend instance
 *
 * Use case: Multiple backend servers registered to the same gateway
 * Example:
 * - Backend A: User's personal machine
 * - Backend B: User's work machine
 * - Both accessible through the same gateway relay
 */
export const gatewayBackendBMode: ModeConfig = {
  id: 'gateway-backend-b',
  name: 'Gateway - Backend B',  // Clear naming to distinguish backends
  enabled: !!process.env.GATEWAY_BACKEND_B_ID,  // Only enabled if backend ID provided

  // Same gateway server for both backends
  serverAddress: 'localhost:3200',
  gatewayUrl: 'ws://localhost:3200',
  gatewaySecret: process.env.GATEWAY_SECRET || 'test-secret-zclaudia-2026',  // Same gateway secret

  // Different backend configuration
  backendId: process.env.GATEWAY_BACKEND_B_ID || '',  // Unique backend ID
  apiKey: process.env.GATEWAY_BACKEND_B_KEY || '',    // Specific backend API key
  requiresAuth: true,

  // Optional: Different proxy for this specific backend
  proxyUrl: process.env.GATEWAY_BACKEND_B_PROXY_URL,
  proxyAuth: process.env.GATEWAY_BACKEND_B_PROXY_USER ? {
    username: process.env.GATEWAY_BACKEND_B_PROXY_USER,
    password: process.env.GATEWAY_BACKEND_B_PROXY_PASS || ''
  } : undefined,
};
