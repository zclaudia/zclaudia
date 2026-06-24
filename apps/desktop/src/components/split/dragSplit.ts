import { create } from 'zustand';
import type { LayoutNode } from '../../stores/splitLayoutStore';
import { findSingletonConflict, isSingleton } from '../../stores/panelInstance';

/** A drop zone within a pane. `center` = replace; edges = split in that direction. */
export type DropZone = 'left' | 'right' | 'top' | 'bottom' | 'center';

/** Fraction of the pane (from the center) that counts as the center "replace" zone. */
const CENTER_DEADZONE = 0.4; // inner 40% × 40%

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Decide which drop zone of a pane the pointer is over, given the pane's rect.
 * The inner CENTER_DEADZONE×CENTER_DEADZONE square maps to `center`; otherwise the
 * pointer is classified by the half it falls in (horizontal → left/right,
 * vertical → top/bottom), using whichever axis is more extreme.
 */
export function resolveDropZone(rect: Rect, pointerX: number, pointerY: number): DropZone {
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const dx = (pointerX - cx) / (rect.width / 2); // -1..1 across the width
  const dy = (pointerY - cy) / (rect.height / 2); // -1..1 across the height

  const halfDead = CENTER_DEADZONE / 2;
  if (Math.abs(dx) <= halfDead && Math.abs(dy) <= halfDead) return 'center';

  // Classify by the more-extreme axis.
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx < 0 ? 'left' : 'right';
  }
  return dy < 0 ? 'top' : 'bottom';
}

/** Map a drop zone to a split direction + whether the new pane goes first. */
export function dropZoneToDir(zone: DropZone): { dir: 'row' | 'col'; insertFirst: boolean } | null {
  switch (zone) {
    case 'left':
      return { dir: 'row', insertFirst: true };
    case 'right':
      return { dir: 'row', insertFirst: false };
    case 'top':
      return { dir: 'col', insertFirst: true };
    case 'bottom':
      return { dir: 'col', insertFirst: false };
    case 'center':
      return null;
  }
}

export interface PanelPayload {
  panelId: string;
  instanceKey?: string;
}

/**
 * Whether dropping `payload` onto `targetPaneId` at `zone` is allowed, consulting
 * the singleton guard. `center` replaces the target pane's panel (excludes the
 * target itself); an edge split adds a new pane (excludes nothing).
 */
export function canDrop(
  root: LayoutNode | null,
  targetPaneId: string,
  zone: DropZone,
  payload: PanelPayload,
): { allowed: boolean; conflictPaneId: string | null } {
  const splitInfo = dropZoneToDir(zone);
  if (!splitInfo) {
    // center = replace → exclude the target pane itself.
    const conflict = findSingletonConflict(root, payload.panelId, payload.instanceKey, targetPaneId);
    return { allowed: !conflict, conflictPaneId: conflict };
  }
  // edge = split → the new pane is independent; consider all existing panes.
  const conflict = findSingletonConflict(
    root,
    payload.panelId,
    payload.instanceKey,
    '\u0000__split_new__',
  );
  return { allowed: !conflict, conflictPaneId: conflict };
}

/**
 * Which of the five zones must be disabled for a given payload against the whole
 * tree, so the overlay can grey them out. A zone is disabled iff dropping there
 * would create a singleton conflict.
 */
export function disabledZones(
  root: LayoutNode | null,
  targetPaneId: string,
  payload: PanelPayload,
): Set<DropZone> {
  const disabled = new Set<DropZone>();
  // Only singleton payloads can conflict; terminal's only conflict is same-scope,
  // which still blocks an edge split (a second same-scope terminal) but a center
  // replace onto the same pane is always fine (excludes itself).
  const zones: DropZone[] = ['left', 'right', 'top', 'bottom', 'center'];
  for (const zone of zones) {
    if (!canDrop(root, targetPaneId, zone, payload).allowed) disabled.add(zone);
  }
  return disabled;
}

/** Re-export for convenience. */
export { isSingleton };

// --- drag state -------------------------------------------------------------
// A tiny store (NOT the layout store) so the overlay can subscribe to the active
// drag without re-rendering the whole layout tree on every pointermove.

interface DragState {
  active: PanelPayload | null;
  /** Pane id under the pointer + its resolved zone (updated on pointermove). */
  hoverPaneId: string | null;
  hoverZone: DropZone | null;
  /** Set of zones disabled for the current payload vs the hovered pane. */
  disabled: Set<DropZone>;
  startDrag: (payload: PanelPayload) => void;
  setHover: (paneId: string | null, zone: DropZone | null, disabled: Set<DropZone>) => void;
  endDrag: () => void;
}

export const useDragSplitStore = create<DragState>((set) => ({
  active: null,
  hoverPaneId: null,
  hoverZone: null,
  disabled: new Set(),
  startDrag: (payload) => set({ active: payload, hoverPaneId: null, hoverZone: null, disabled: new Set() }),
  setHover: (paneId, zone, disabled) => set({ hoverPaneId: paneId, hoverZone: zone, disabled }),
  endDrag: () => set({ active: null, hoverPaneId: null, hoverZone: null, disabled: new Set() }),
}));

/**
 * Resolve a pointer event over the split content area to (paneId, zone, disabled).
 * Reads each `[data-pane-id]` element's rect, finds the one containing the pointer,
 * and computes its drop zone + disabled zones against the layout tree. Returns
 * paneId=null when the pointer is over no pane. Pure (no React) so it is testable
 * and reusable from the host's pointermove/up handlers.
 */
export function resolvePointerToPane(
  containerEl: HTMLElement | null,
  root: LayoutNode | null,
  clientX: number,
  clientY: number,
  payload: PanelPayload,
): { paneId: string; zone: DropZone; disabled: Set<DropZone> } | null {
  if (!containerEl) return null;
  const panes = Array.from(containerEl.querySelectorAll<HTMLElement>('[data-pane-id]'));
  for (const el of panes) {
    const r = el.getBoundingClientRect();
    if (
      clientX >= r.left && clientX <= r.right &&
      clientY >= r.top && clientY <= r.bottom
    ) {
      const paneId = el.getAttribute('data-pane-id')!;
      const zone = resolveDropZone(
        { left: r.left, top: r.top, width: r.width, height: r.height },
        clientX,
        clientY,
      );
      const disabled = disabledZones(root, paneId, payload);
      return { paneId, zone, disabled };
    }
  }
  return null;
}
