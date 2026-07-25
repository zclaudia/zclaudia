/**
 * Semantic tone recipes for status text and tinted badges.
 *
 * Replaces the per-feature raw-palette maps (`bg-blue-500/20 text-blue-400` …)
 * that violate ui-conventions rule 1 (color is semantics only). Every tone is
 * theme-token-backed, so all four themes and the generator's WCAG contrast
 * floors apply automatically — raw palette classes bypassed both.
 */
export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'destructive' | 'thinking';

/** Plain status text (sidebar row status, inline labels). */
export const TONE_TEXT: Record<Tone, string> = {
  neutral: 'text-muted-foreground',
  info: 'text-primary',
  success: 'text-success',
  warning: 'text-warning',
  destructive: 'text-destructive',
  thinking: 'text-thinking',
};

/** Tinted pill/badge fill + text. */
export const TONE_BADGE: Record<Tone, string> = {
  neutral: 'bg-muted text-muted-foreground',
  info: 'bg-primary/15 text-primary',
  success: 'bg-success/15 text-success',
  warning: 'bg-warning/15 text-warning',
  destructive: 'bg-destructive/15 text-destructive',
  thinking: 'bg-thinking/15 text-thinking',
};

/** Solid status dot. */
export const TONE_DOT: Record<Tone, string> = {
  neutral: 'bg-muted-foreground/40',
  info: 'bg-primary',
  success: 'bg-success',
  warning: 'bg-warning',
  destructive: 'bg-destructive',
  thinking: 'bg-thinking',
};
