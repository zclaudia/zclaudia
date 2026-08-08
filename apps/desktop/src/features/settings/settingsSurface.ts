import { useIsMobile } from '../../hooks/useMediaQuery';

/**
 * Which device class each settings surface belongs on.
 *
 * Desktop settings administer *this machine*: its embedded backend, the
 * processes it spawned, the agent CLIs installed on it. Mobile settings talk to
 * *someone else's* machine over the gateway, where the useful verbs are
 * connect, observe and adjudicate. So a row that installs software, kills
 * processes or authors shell commands does not belong on a phone; a row that
 * flips an approval policy very much does.
 *
 * This table is the whole decision, in one readable place, instead of a dozen
 * `!isMobile` conditions spread across the settings tree. It covers the
 * *viewport* axis only — platform gates (`isAndroid`, `isMacOS`,
 * `isDesktopTauri`) are a separate axis and stay at their call sites.
 */
export type SettingsSurface = 'both' | 'desktop' | 'mobile';

export interface SettingsSurfaceDef {
  surface: SettingsSurface;
  /** Rendered but not editable here — for rows where seeing the value still matters. */
  readOnlyOn?: 'mobile' | 'desktop';
  /** Rendered behind a disclosure here — for low-frequency tuning knobs. */
  collapsedOn?: 'mobile' | 'desktop';
  /** Why it is restricted. Omitted when the entry is unrestricted. */
  why?: string;
}

export const SETTINGS_SURFACES = {
  // --- Tabs ---------------------------------------------------------------
  'tab.general': { surface: 'both' },
  'tab.agent': { surface: 'both' },
  'tab.permissions': { surface: 'both' },
  'tab.gateway': { surface: 'both' },
  'tab.debug': { surface: 'both' },
  'tab.about': { surface: 'both' },

  // --- General ------------------------------------------------------------
  'general.appearance': { surface: 'both' },
  'general.notch-panel': {
    surface: 'desktop',
    why: 'Positions an overlay window on a desktop display',
  },

  // --- Claudia (agent) ----------------------------------------------------
  'agent.general': { surface: 'both' },
  'agent.managed-clis': {
    surface: 'desktop',
    why: 'Installs, pins and garbage-collects software on the backend host',
  },
  'agent.capabilities': {
    surface: 'desktop',
    why: 'A long read-only inventory with nothing to act on',
  },

  // --- Permissions --------------------------------------------------------
  'permissions.auto-approve': { surface: 'both' },
  'permissions.categories': { surface: 'both' },
  'permissions.tool-rules': {
    surface: 'both',
    readOnlyOn: 'mobile',
    why: 'Authoring Bash(git *) patterns by thumb; the rules in force still matter',
  },
  'permissions.hooks': {
    surface: 'both',
    readOnlyOn: 'mobile',
    why: 'Authoring privileged shell commands by thumb; the hooks in force still matter',
  },
  'permissions.ai-review': { surface: 'both' },
  'permissions.ai-review-tuning': {
    surface: 'both',
    collapsedOn: 'mobile',
    why: 'Three numeric knobs nobody tunes from a phone',
  },
  'permissions.workflow': { surface: 'both' },
  'permissions.safety-guards': { surface: 'both' },

  // --- Connection ---------------------------------------------------------
  'gateway.config': { surface: 'both' },

  // --- Debug --------------------------------------------------------------
  'debug.crash-reports': { surface: 'both' },
  'debug.managed-processes': { surface: 'both' },
  'debug.client-logs': { surface: 'both' },
  'debug.permission-logs': { surface: 'both' },
  'debug.process-cleanup': {
    surface: 'desktop',
    why: 'Kills processes on the backend host, blind from a phone',
  },
  'debug.ai-review-simulator': {
    surface: 'desktop',
    why: 'A developer test harness with six inputs',
  },

  // --- About --------------------------------------------------------------
  'about.version': { surface: 'both' },
} as const satisfies Record<string, SettingsSurfaceDef>;

export type SettingsSurfaceId = keyof typeof SETTINGS_SURFACES;

function currentSurface(isMobile: boolean): 'mobile' | 'desktop' {
  return isMobile ? 'mobile' : 'desktop';
}

export function isVisibleOnSurface(id: SettingsSurfaceId, isMobile: boolean): boolean {
  const def: SettingsSurfaceDef = SETTINGS_SURFACES[id];
  return def.surface === 'both' || def.surface === currentSurface(isMobile);
}

export function isReadOnlyOnSurface(id: SettingsSurfaceId, isMobile: boolean): boolean {
  const def: SettingsSurfaceDef = SETTINGS_SURFACES[id];
  return def.readOnlyOn === currentSurface(isMobile);
}

export function isCollapsedOnSurface(id: SettingsSurfaceId, isMobile: boolean): boolean {
  const def: SettingsSurfaceDef = SETTINGS_SURFACES[id];
  return def.collapsedOn === currentSurface(isMobile);
}

export interface ResolvedSettingsSurface {
  visible: boolean;
  readOnly: boolean;
  collapsed: boolean;
}

/** Resolve one entry against the live viewport. */
export function useSettingsSurface(id: SettingsSurfaceId): ResolvedSettingsSurface {
  const isMobile = useIsMobile();
  return {
    visible: isVisibleOnSurface(id, isMobile),
    readOnly: isReadOnlyOnSurface(id, isMobile),
    collapsed: isCollapsedOnSurface(id, isMobile),
  };
}
