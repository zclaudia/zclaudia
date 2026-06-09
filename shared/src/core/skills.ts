export type SkillSource = 'workspace' | 'external' | 'plugin';

export type SkillSourceRef =
  | { source: 'workspace' }
  | { source: 'external' }
  | { source: 'plugin'; pluginId?: string };

export interface SkillRef {
  source: SkillSource;
  id: string;
}

export interface SkillSelection {
  providers?: SkillSourceRef[];
  include?: SkillRef[];
  exclude?: SkillRef[];
  pinned?: SkillRef[];
}

export type SkillExecutionMode = 'inline' | 'fork';
export type SkillForkToolPolicy = 'read-only' | 'web' | 'workspace-edit' | 'agent-default';

export interface SkillExecutionOverride {
  ref: SkillRef;
  allowedModes?: SkillExecutionMode[];
  defaultMode?: SkillExecutionMode;
  forkToolPolicy?: SkillForkToolPolicy;
}

export interface SkillExecutionSelection {
  overrides?: SkillExecutionOverride[];
}

export interface SkillCatalogEntry {
  source: SkillSource;
  id: string;
}

export interface ResolvedSkillSelection<T extends SkillCatalogEntry = SkillCatalogEntry> {
  discoverable: T[];
  pinned: SkillRef[];
}

export const defaultSkillSelection: SkillSelection = {
  providers: [
    { source: 'workspace' },
    { source: 'external' },
    { source: 'plugin' },
  ],
  include: [],
  exclude: [],
  pinned: [],
};

export function skillRefKey(ref: SkillRef | SkillCatalogEntry): string {
  return `${ref.source}:${ref.id}`;
}

function normalizeSkillSourceRef(ref: unknown): SkillSourceRef | undefined {
  if (!ref || typeof ref !== 'object') return undefined;
  const row = ref as Record<string, unknown>;
  if (row.source === 'workspace') return { source: 'workspace' };
  if (row.source === 'external') return { source: 'external' };
  if (row.source === 'plugin') {
    return {
      source: 'plugin',
      ...(typeof row.pluginId === 'string' && row.pluginId.trim()
        ? { pluginId: row.pluginId.trim() }
        : {}),
    };
  }
  return undefined;
}

function normalizeSkillRef(ref: unknown): SkillRef | undefined {
  if (!ref || typeof ref !== 'object') return undefined;
  const row = ref as Record<string, unknown>;
  if (
    (row.source === 'workspace' || row.source === 'external' || row.source === 'plugin')
    && typeof row.id === 'string'
    && row.id.trim()
  ) {
    return { source: row.source, id: row.id.trim() };
  }
  return undefined;
}

function uniqueByKey<T extends SkillSourceRef | SkillRef>(
  refs: T[],
  keyFn: (ref: T) => string,
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const ref of refs) {
    const key = keyFn(ref);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ref);
  }
  return out;
}

function uniqueStrings<T extends string>(values: T[]): T[] {
  return [...new Set(values)];
}

export function normalizeSkillSelection(value: unknown): SkillSelection | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as Record<string, unknown>;
  const providers = Array.isArray(candidate.providers)
    ? uniqueByKey(candidate.providers.flatMap((ref) => {
      const normalized = normalizeSkillSourceRef(ref);
      return normalized ? [normalized] : [];
    }), (ref) => ref.source === 'plugin' ? `plugin:${ref.pluginId ?? '*'}` : ref.source)
    : [];
  const include = Array.isArray(candidate.include)
    ? uniqueByKey(candidate.include.flatMap((ref) => {
      const normalized = normalizeSkillRef(ref);
      return normalized ? [normalized] : [];
    }), skillRefKey)
    : [];
  const exclude = Array.isArray(candidate.exclude)
    ? uniqueByKey(candidate.exclude.flatMap((ref) => {
      const normalized = normalizeSkillRef(ref);
      return normalized ? [normalized] : [];
    }), skillRefKey)
    : [];
  const pinned = Array.isArray(candidate.pinned)
    ? uniqueByKey(candidate.pinned.flatMap((ref) => {
      const normalized = normalizeSkillRef(ref);
      return normalized ? [normalized] : [];
    }), skillRefKey)
    : [];
  return { providers, include, exclude, pinned };
}

function normalizeExecutionMode(value: unknown): SkillExecutionMode | undefined {
  return value === 'inline' || value === 'fork' ? value : undefined;
}

function normalizeForkToolPolicy(value: unknown): SkillForkToolPolicy | undefined {
  return value === 'read-only' || value === 'web' || value === 'workspace-edit' || value === 'agent-default'
    ? value
    : undefined;
}

function normalizeExecutionOverride(value: unknown): SkillExecutionOverride | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const row = value as Record<string, unknown>;
  const ref = normalizeSkillRef(row.ref);
  if (!ref) return undefined;

  const allowedModes = Array.isArray(row.allowedModes)
    ? uniqueStrings(row.allowedModes.flatMap((mode) => {
      const normalized = normalizeExecutionMode(mode);
      return normalized ? [normalized] : [];
    }))
    : undefined;
  const defaultMode = normalizeExecutionMode(row.defaultMode);
  const forkToolPolicy = normalizeForkToolPolicy(row.forkToolPolicy);

  return {
    ref,
    ...(allowedModes && allowedModes.length > 0 ? { allowedModes } : {}),
    ...(defaultMode ? { defaultMode } : {}),
    ...(forkToolPolicy ? { forkToolPolicy } : {}),
  };
}

export function normalizeSkillExecutionSelection(value: unknown): SkillExecutionSelection | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as Record<string, unknown>;
  const byRef = new Map<string, SkillExecutionOverride>();
  if (Array.isArray(candidate.overrides)) {
    for (const override of candidate.overrides) {
      const normalized = normalizeExecutionOverride(override);
      if (!normalized) continue;
      byRef.set(skillRefKey(normalized.ref), normalized);
    }
  }
  return { overrides: [...byRef.values()] };
}

function providerMatches<T extends SkillCatalogEntry>(skill: T, provider: SkillSourceRef): boolean {
  return provider.source === skill.source;
}

export function resolveSkillSelection<T extends SkillCatalogEntry>(
  discoveredSkills: T[],
  selection?: SkillSelection,
): ResolvedSkillSelection<T> {
  if (!selection) {
    return { discoverable: [...discoveredSkills], pinned: [] };
  }

  const providers = selection.providers ?? [];
  const includeKeys = new Set((selection.include ?? []).map(skillRefKey));
  const excludeKeys = new Set((selection.exclude ?? []).map(skillRefKey));
  const byKey = new Map(discoveredSkills.map((skill) => [skillRefKey(skill), skill]));
  const selected = new Map<string, T>();

  if (providers.length === 0) {
    for (const skill of discoveredSkills) {
      selected.set(skillRefKey(skill), skill);
    }
  } else {
    for (const skill of discoveredSkills) {
      if (providers.some((provider) => providerMatches(skill, provider))) {
        selected.set(skillRefKey(skill), skill);
      }
    }
  }

  for (const key of includeKeys) {
    const skill = byKey.get(key);
    if (skill) selected.set(key, skill);
  }

  for (const key of excludeKeys) {
    selected.delete(key);
  }

  const visibleKeys = new Set(selected.keys());
  const pinned = (selection.pinned ?? []).filter((ref) => visibleKeys.has(skillRefKey(ref)));

  return {
    discoverable: discoveredSkills.filter((skill) => visibleKeys.has(skillRefKey(skill))),
    pinned,
  };
}
