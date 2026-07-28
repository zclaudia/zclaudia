// Backward-compatible host entrypoint. The public plugin contract lives in
// @zclaudia/plugin-sdk so external plugins never depend on this workspace.
export type {
  PermissionCallback,
  PermissionDecision,
  PermissionRequest,
} from '@zclaudia/plugin-sdk/providers';
