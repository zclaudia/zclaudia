import type { ModeConfig } from '../../helpers/modes';

/**
 * Gateway Backend A Configuration
 * Same gateway server, different backend instance
 *
 * Use case: Multiple backend servers registered to the same gateway
 * Example:
 * - Backend A: User's personal machine
 * - Backend B: User's work machine
 * - Both accessible through the same gateway relay
 */
export const gatewayBackendAMode: ModeConfig = {
  id: 'gateway-backend-a',
  name: 'Gateway - Backend A',  // Clear naming to distinguish backends
  enabled: !!process.env.GATEWAY_BACKEND_A_ID,  // Only enabled if backend ID provided

  // Same gateway server for both backends
  serverAddress: 'localhost:3200',
  gatewayUrl: 'ws://localhost:3200',
  gatewaySecret: process.env.GATEWAY_SECRET || 'test-secret-zclaudia-2026',  // Same gateway secret

  // Different backend configuration
  backendId: process.env.GATEWAY_BACKEND_A_ID || '',  // Unique backend ID
  apiKey: process.env.GATEWAY_BACKEND_A_KEY || '',    // Specific backend API key
  requiresAuth: true,

  // Optional: Different proxy for this specific backend
  proxyUrl: process.env.GATEWAY_BACKEND_A_PROXY_URL,
  proxyAuth: process.env.GATEWAY_BACKEND_A_PROXY_USER ? {
    username: process.env.GATEWAY_BACKEND_A_PROXY_USER,
    password: process.env.GATEWAY_BACKEND_A_PROXY_PASS || ''
  } : undefined,
};
