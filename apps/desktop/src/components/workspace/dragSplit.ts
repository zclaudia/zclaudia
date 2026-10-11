import { create } from 'zustand';
import { findPane, sameRef, type LayoutNode, type WorkspaceEdge } from '../../stores/rightWorkspaceStore';
import { MULTI_INSTANCE_PANELS } from '../../stores/panelInstance';

/** A drop zone within a pane. `center` = replace; edges = split in that direction. */
export type DropZone = 'left' | 'right' | 'top' | 'bottom' | 'center';

/** Fraction of the pane (from the center) that counts as the center "replace" zone. */
const CENTER_DEADZONE = 0.4; // inner 40% × 40%

/**
 * Pointer travel (px, per axis) below which a pointerup counts as a click on the
 * drag affordance instead of a drop, so grabbing a handle without moving never
 * commits a split.
 */
export const DRAG_CLICK_THRESHOLD_PX = 4;

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Only the viewport's outer gutter is a root target; pane edges remain independent. */
export function resolveRootDrop(rect: Rect, pointerX: number, pointerY: number, gutter = 8): WorkspaceEdge | null {
  const x = pointerX - rect.left;
  const y = pointerY - rect.top;
  if (rect.width <= 0 || rect.height <= 0 || x < 0 || y < 0 || x > rect.width || y > rect.height) return null;
  const edges: Array<[WorkspaceEdge, number]> = [['left', x], ['right', rect.width - x], ['top', y], ['bottom', rect.height - y]];
  edges.sort((a, b) => a[1] - b[1]);
  return edges[0][1] <= gutter ? edges[0][0] : null;
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

export interface ToolDragPayload {
  /** Catalog owner for sidebar drags that do not yet have a workspace ref. */
  projectId?: string;
  toolId: string;
  instanceKey?: string;
  multiInstance?: boolean;
  /** When the drag originates from a tab: the source pane + its index in that pane's strip. */
  sourcePaneId?: string;
  sourceIndex?: number;
}

/**
 * Check the current tree, including chat isolation and singleton identities.
 * A move excludes only its exact source ref, while a new drop excludes nothing
 * on edges. Call again at pointerup: a hovered target can disappear during drag.
 */
export function canDrop(
  root: LayoutNode | null,
  targetPaneId: string,
  zone: DropZone,
  payload: ToolDragPayload
): { allowed: boolean; conflictPaneId: string | null } {
  const target = findPane(root, targetPaneId);
  if (!target) return { allowed: false, conflictPaneId: null };
  const edge = zone !== 'center';
  const chat = payload.toolId === 'chat';
  if (!edge && (chat || target.tools.some(ref => ref.toolId === 'chat'))) {
    return { allowed: false, conflictPaneId: targetPaneId };
  }

  const source = payload.sourcePaneId ? findPane(root, payload.sourcePaneId) : null;
  const sourceIndex = payload.sourceIndex ?? source?.tools.findIndex(ref =>
    sameRef(ref, payload.toolId, payload.instanceKey));
  const moving = source && sourceIndex !== undefined && sourceIndex >= 0 &&
    sameRef(source.tools[sourceIndex] ?? { toolId: '' }, payload.toolId, payload.instanceKey);
  // Never turn an obsolete source/index into an unintended new tool instance.
  if (payload.sourcePaneId && !moving) return { allowed: false, conflictPaneId: null };
  if (edge && moving && source.id === targetPaneId && source.tools.length === 1) {
    return { allowed: false, conflictPaneId: targetPaneId };
  }

  const singleton = !chat && !payload.multiInstance;
  const visit = (node: LayoutNode | null): string | null => {
    if (!node) return null;
    if (node.kind === 'placeholder') return null;
    if (node.kind === 'group') return visit(node.children[0]) ?? visit(node.children[1]);
    for (const [index, ref] of node.tools.entries()) {
      if (moving && node.id === source.id && index === sourceIndex) continue;
      // The existing center operation can activate/replace a target's own ref.
      if (!edge && node.id === targetPaneId) continue;
      if (ref.toolId === payload.toolId && (singleton || ref.instanceKey === payload.instanceKey)) {
        return node.id;
      }
    }
    return null;
  };
  const conflict = visit(root);
  return { allowed: conflict === null, conflictPaneId: conflict };
}

/**
 * Which of the five zones must be disabled for a given payload against the whole
 * tree, so the overlay can grey them out. A zone is disabled iff dropping there
 * would create a singleton conflict.
 */
export function disabledZones(
  root: LayoutNode | null,
  targetPaneId: string,
  payload: ToolDragPayload
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

// Re-export for convenience (callers may need to check multi-instance membership).
export { MULTI_INSTANCE_PANELS };

// --- drag state -------------------------------------------------------------
// A tiny store (NOT the layout store) so the overlay can subscribe to the active
// drag without re-rendering the whole layout tree on every pointermove.

interface DragState {
  active: ToolDragPayload | null;
  hoverRootEdge: WorkspaceEdge | null;
  /** Pointer position where the active drag began; null for programmatic starts. */
  origin: { x: number; y: number } | null;
  setRootHover: (edge: WorkspaceEdge | null) => void;
  /** Pane id under the pointer + its resolved zone (updated on pointermove). */
  hoverPaneId: string | null;
  hoverZone: DropZone | null;
  /** Set of zones disabled for the current payload vs the hovered pane. */
  disabled: Set<DropZone>;
  /** Tab strip under the pointer + the insert index within it (updated on pointermove). */
  hoverTabPaneId: string | null;
  hoverTabIndex: number | null;
  startDrag: (payload: ToolDragPayload, origin?: { x: number; y: number }) => void;
  /**
   * True when the pointerup at (x, y) never left the click threshold since
   * startDrag. Programmatic drags without an origin always count as drops.
   */
  isClick: (x: number, y: number) => boolean;
  setHover: (paneId: string | null, zone: DropZone | null, disabled: Set<DropZone>) => void;
  setTabHover: (paneId: string | null, index: number | null) => void;
  endDrag: () => void;
}

export const useDragSplitStore = create<DragState>()((set, get) => ({
  active: null,
  hoverRootEdge: null,
  origin: null,
  hoverPaneId: null,
  hoverZone: null,
  disabled: new Set(),
  hoverTabPaneId: null,
  hoverTabIndex: null,
  startDrag: (payload, origin) =>
    set({
      active: payload,
      origin: origin ?? null,
      hoverRootEdge: null,
      hoverPaneId: null,
      hoverZone: null,
      disabled: new Set(),
      hoverTabPaneId: null,
      hoverTabIndex: null,
    }),
  isClick: (x, y) => {
    const origin = get().origin;
    if (!origin) return false;
    return Math.abs(x - origin.x) < DRAG_CLICK_THRESHOLD_PX && Math.abs(y - origin.y) < DRAG_CLICK_THRESHOLD_PX;
  },
  setHover: (paneId, zone, disabled) => set({ hoverPaneId: paneId, hoverZone: zone, disabled }),
  setRootHover: hoverRootEdge => set({ hoverRootEdge }),
  setTabHover: (paneId, index) => set({ hoverTabPaneId: paneId, hoverTabIndex: index }),
  endDrag: () =>
    set({
      active: null,
      origin: null,
      hoverRootEdge: null,
      hoverPaneId: null,
      hoverZone: null,
      disabled: new Set(),
      hoverTabPaneId: null,
      hoverTabIndex: null,
    }),
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
  payload: ToolDragPayload
): { paneId: string; zone: DropZone; disabled: Set<DropZone> } | null {
  if (!containerEl) return null;
  const panes = Array.from(containerEl.querySelectorAll<HTMLElement>('[data-pane-id]'));
  for (const el of panes) {
    const r = el.getBoundingClientRect();
    if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
      const paneId = el.getAttribute('data-pane-id');
      if (!paneId) continue;
      const zone = resolveDropZone(
        { left: r.left, top: r.top, width: r.width, height: r.height },
        clientX,
        clientY
      );
      const disabled = disabledZones(root, paneId, payload);
      return { paneId, zone, disabled };
    }
  }
  return null;
}

/**
 * Resolve a pointer over a tab strip to (paneId, insertIndex). Scans
 * `[data-tab-strip]` elements; the insert index is the count of tabs whose
 * horizontal midpoint is left of the pointer. Returns null when not over a strip.
 * Pure (no React) for testability.
 */
export function resolveTabDrop(
  containerEl: HTMLElement | null,
  clientX: number,
  clientY: number
): { paneId: string; index: number } | null {
  if (!containerEl) return null;
  const strips = Array.from(containerEl.querySelectorAll<HTMLElement>('[data-tab-strip]'));
  for (const strip of strips) {
    const r = strip.getBoundingClientRect();
    if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) continue;
    const paneId = strip.getAttribute('data-pane-id');
    if (!paneId) continue;
    const tabs = Array.from(strip.querySelectorAll<HTMLElement>('[data-tab-index]'));
    let index = 0;
    for (const tab of tabs) {
      const tr = tab.getBoundingClientRect();
      if (clientX >= tr.left + tr.width / 2) index += 1;
    }
    return { paneId, index };
  }
  return null;
}
