import type { DesignViewport, DesignViewportPreset, DesignZoom } from '../types';

/**
 * UI metadata persisted per workspace identity (P2 §2.3 storage bullet):
 * recents / active page / viewport & zoom preferences. Drafts and the open
 * page list are intentionally NOT persisted.
 */
export interface DesignWorkspaceUiState {
  version: 1;
  /** 上次活动页（重新打开面板时恢复；null = 走发现流程）。 */
  activePath: string | null;
  /** 最近打开，去重，上限 12。 */
  recents: string[];
  viewport: DesignViewport;
  zoom: DesignZoom;
}

export const WORKSPACE_UI_STORAGE_PREFIX = 'zclaudia-design-ws-';

export const WORKSPACE_UI_VERSION = 1;

const RECENTS_LIMIT = 12;
const VIEWPORT_MIN_WIDTH = 240;
const VIEWPORT_MAX_WIDTH = 3840;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 2;

const VIEWPORT_PRESETS: DesignViewportPreset[] = ['fill', 'desktop', 'tablet', 'mobile', 'custom'];

/** Fresh default state (never hand out a mutable shared object). */
export function defaultWorkspaceUiState(): DesignWorkspaceUiState {
  return {
    version: 1,
    activePath: null,
    recents: [],
    viewport: { preset: 'fill', width: null },
    zoom: { mode: 'fit', value: 1 },
  };
}

export function workspaceUiStorageKey(identityKey: string): string {
  return `${WORKSPACE_UI_STORAGE_PREFIX}${identityKey}`;
}

/** Viewport field validation: width must be an integer in 240–3840, else fall back to fill/null. */
export function normalizeViewport(input: unknown): DesignViewport {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const preset =
    typeof raw.preset === 'string' && (VIEWPORT_PRESETS as string[]).includes(raw.preset)
      ? (raw.preset as DesignViewportPreset)
      : 'fill';
  const width = raw.width;
  const validWidth =
    typeof width === 'number' &&
    Number.isInteger(width) &&
    width >= VIEWPORT_MIN_WIDTH &&
    width <= VIEWPORT_MAX_WIDTH
      ? width
      : null;
  if (validWidth === null || preset === 'fill') return { preset: 'fill', width: null };
  return { preset, width: validWidth };
}

/** Zoom field validation: mode fit|manual, value clamped to 0.25–2. */
export function normalizeZoom(input: unknown): DesignZoom {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const mode = raw.mode === 'manual' ? 'manual' : 'fit';
  const value =
    typeof raw.value === 'number' && Number.isFinite(raw.value)
      ? Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, raw.value))
      : 1;
  return { mode, value };
}

/**
 * Field-level validation of a persisted (or constructed) state. Anything
 * invalid falls back per field; a wrong version or non-object yields defaults.
 */
export function normalizeUiState(input: unknown): DesignWorkspaceUiState {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return defaultWorkspaceUiState();
  const raw = input as Record<string, unknown>;
  if (raw.version !== WORKSPACE_UI_VERSION) return defaultWorkspaceUiState();
  return {
    version: 1,
    activePath: typeof raw.activePath === 'string' ? raw.activePath : null,
    recents: Array.isArray(raw.recents)
      ? raw.recents.filter((entry): entry is string => typeof entry === 'string').slice(0, RECENTS_LIMIT)
      : [],
    viewport: normalizeViewport(raw.viewport),
    zoom: normalizeZoom(raw.zoom),
  };
}

function getStorage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

/** Load the persisted state for one identity; corrupt/incompatible data returns defaults. */
export function loadWorkspaceUiState(identityKey: string): DesignWorkspaceUiState {
  const storage = getStorage();
  if (!storage) return defaultWorkspaceUiState();
  let raw: string | null;
  try {
    raw = storage.getItem(workspaceUiStorageKey(identityKey));
  } catch {
    return defaultWorkspaceUiState();
  }
  if (!raw) return defaultWorkspaceUiState();
  try {
    return normalizeUiState(JSON.parse(raw));
  } catch {
    return defaultWorkspaceUiState();
  }
}

/** Persist synchronously; storage unavailability or quota errors are silently ignored. */
export function saveWorkspaceUiState(identityKey: string, state: DesignWorkspaceUiState): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(workspaceUiStorageKey(identityKey), JSON.stringify(state));
  } catch {
    // quota exceeded or storage disabled: preferences stay in-memory only
  }
}

export const WORKSPACE_UI_RECENTS_LIMIT = RECENTS_LIMIT;
