import type { GatewayBackendInfo } from '@zclaudia/shared/core/server';

/**
 * Gateway config / status data shapes. Owned by the infra gateway module so
 * infra consumers (gateway manager, gateway state) don't have to import the
 * HTTP interface layer; interfaces/http/gateway.ts re-exports them for its
 * existing consumers.
 */
export interface GatewayConfig {
  id: number;
  enabled: boolean;
  gatewayUrl: string | null;
  /**
   * Legacy API/storage field name (DB column: gateway_secret). The value is
   * a gateway-issued peer credential (zgd_/zgb_/zga_); the name predates the
   * credential split and is kept as a compatibility boundary.
   */
  gatewaySecret: string | null;
  backendName: string | null;
  gatewayBackendId: string | null;
  registerAsBackend: boolean;
  proxyUrl?: string | null;
  proxyUsername?: string | null;
  proxyPassword?: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface GatewayStatus {
  enabled: boolean;
  connected: boolean;
  gatewayBackendId: string | null;
  gatewayUrl: string | null;
  gatewaySecret: string | null;
  backendName: string | null;
  registerAsBackend: boolean;
  discoveredBackends: GatewayBackendInfo[];
  instanceId?: string;
  currentDeviceId?: string;
}
