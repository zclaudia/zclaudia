// Pure derivation helpers for the Sidebar: agent-readiness reason parsing,
// empty-backend-tree messaging, context-menu positioning, and the Claudia
// nav badge status. No React, no component state.
import type { BackendConnectionState } from '@zclaudia/shared/facade/types';
import type { AgentReadinessReason } from '@zclaudia/shared/core/agent-readiness';
import { isMobileGatewayConnected } from '../../services/mobileConnectionState';

const AGENT_READINESS_REASONS = new Set<AgentReadinessReason>([
  'no_agent',
  'no_llm_profile',
  'no_credential',
  'no_model',
  'runtime_unavailable',
  'runtime_missing',
  'runtime_incompatible',
  'runtime_auth_required',
  'runtime_check_failed',
]);

/** Extract a known readiness reason from an AGENT_NOT_READY error's details. */
export function agentReadinessReasonFromDetails(
  details: unknown
): AgentReadinessReason | undefined {
  if (!details || typeof details !== 'object') return undefined;
  const reason = (details as { reason?: unknown }).reason;
  return typeof reason === 'string' && AGENT_READINESS_REASONS.has(reason as AgentReadinessReason)
    ? (reason as AgentReadinessReason)
    : undefined;
}

/** Message shown in place of the backend tree when no backend is online. */
export function getNoBackendsMessage(opts: {
  isMobile?: boolean;
  directGatewayUrl: string | null;
  facadeConnectionState: BackendConnectionState;
}): string {
  if (opts.isMobile && !opts.directGatewayUrl) return 'Gateway not configured';
  if (opts.isMobile && !isMobileGatewayConnected(opts.facadeConnectionState))
    return 'Connecting to gateway...';
  return 'No backends online';
}

/**
 * Position for a project row's context menu. Anchored to the trigger, not the
 * click point — the menu hangs off the row like a standard dropdown. It drops
 * below the ⋯ button (flipping up when it would overflow), and right-aligns to
 * the row's edge so it sits flush (the ⋯ button isn't the row's rightmost
 * element — a "+" sits after it).
 */
export function computeContextMenuPosition(
  btn: DOMRect,
  row: DOMRect,
  isMobile?: boolean
): { top: number; left: number } {
  const menuWidth = isMobile ? 176 : 144;
  const menuHeight = isMobile ? 104 : 60;
  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;
  const margin = 8;

  let top = btn.bottom + 4;
  if (top + menuHeight > viewportH - margin) {
    top = btn.top - menuHeight - 4;
  }
  top = Math.max(margin, Math.min(top, viewportH - menuHeight - margin));

  let left = row.right - menuWidth;
  left = Math.max(margin, Math.min(left, viewportW - menuWidth - margin));

  return { top, left };
}

/** Claudia nav badge: permission prompts outrank unread, which outrank running. */
export function claudiaSidebarStatus(opts: {
  hasPermissionPending: boolean;
  hasUnread: boolean;
  hasRunning: boolean;
}): 'permission' | 'unread' | 'running' | null {
  if (opts.hasPermissionPending) return 'permission';
  if (opts.hasUnread) return 'unread';
  if (opts.hasRunning) return 'running';
  return null;
}
