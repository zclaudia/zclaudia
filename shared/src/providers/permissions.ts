// shared/src/providers/permissions.ts
import type { PermissionRequest } from '../interaction/permissions.js';

export interface PermissionDecision {
  behavior: 'allow' | 'deny';
  updatedInput?: unknown;
  message?: string;
}

export type PermissionCallback = (request: PermissionRequest) => Promise<PermissionDecision>;
