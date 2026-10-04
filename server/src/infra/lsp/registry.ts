/**
 * Where the manager's language-server presets come from: built in, plugins
 * (`contributes.lspServers`) and the user's own definitions (Settings).
 *
 * Priority is user > plugin > built in: a definition with the id of a
 * lower-priority one replaces it, and the manager tries presets in this
 * order, so a higher-priority server claims an extension first.
 */
import { defaultLanguageServerPresets } from './presets.js';
import type { LanguageServerPreset, LanguageServerSource } from './types.js';

export interface RegisteredPreset {
  preset: LanguageServerPreset;
  source: LanguageServerSource;
  pluginId?: string;
}

const PRIORITY: LanguageServerSource[] = ['user', 'plugin', 'builtin'];

export class LanguageServerRegistry {
  private user: LanguageServerPreset[] = [];
  private readonly plugins = new Map<string, LanguageServerPreset[]>();
  private readonly listeners = new Set<() => void>();
  private resolved: RegisteredPreset[] | null = null;

  constructor(private readonly builtin: LanguageServerPreset[] = defaultLanguageServerPresets()) {}

  setUserPresets(presets: LanguageServerPreset[]): void {
    this.user = presets;
    this.changed();
  }

  setPluginPresets(pluginId: string, presets: LanguageServerPreset[]): void {
    if (presets.length === 0) this.plugins.delete(pluginId);
    else this.plugins.set(pluginId, presets);
    this.changed();
  }

  removePlugin(pluginId: string): void {
    if (this.plugins.delete(pluginId)) this.changed();
  }

  /** Something presets depend on changed (a plugin permission): re-check. */
  notifyChanged(): void {
    this.changed();
  }

  /** Effective presets, highest priority first, one per id. */
  entries(): RegisteredPreset[] {
    if (this.resolved) return this.resolved;
    const bySource: Record<LanguageServerSource, RegisteredPreset[]> = {
      user: this.user.map(preset => ({ preset, source: 'user' })),
      plugin: [...this.plugins].flatMap(([pluginId, presets]) =>
        presets.map(preset => ({ preset, source: 'plugin' as const, pluginId }))
      ),
      builtin: this.builtin.map(preset => ({ preset, source: 'builtin' })),
    };
    const seen = new Set<string>();
    const resolved: RegisteredPreset[] = [];
    for (const source of PRIORITY) {
      for (const entry of bySource[source]) {
        if (seen.has(entry.preset.id)) continue;
        seen.add(entry.preset.id);
        resolved.push(entry);
      }
    }
    this.resolved = resolved;
    return resolved;
  }

  presets(): LanguageServerPreset[] {
    return this.entries().map(entry => entry.preset);
  }

  sourceOf(preset: LanguageServerPreset): RegisteredPreset | undefined {
    return this.entries().find(entry => entry.preset === preset);
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed(): void {
    this.resolved = null;
    for (const listener of this.listeners) listener();
  }
}

/** The server process's registry: plugins and Settings register into it. */
export const languageServerRegistry = new LanguageServerRegistry();
