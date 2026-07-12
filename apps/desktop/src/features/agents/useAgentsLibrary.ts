import { useMemo } from 'react';
import type { AgentsBackend, AgentsTab, LibraryItem } from './agents-types';

// Minimal shapes we read — kept loose so upstream record types can widen.
interface ProfileLike {
  id: string;
  name?: string;
  isDefault?: boolean;
  model?: string;
  runtimeType?: string;
  status?: 'active' | 'readonly';
}
interface SkillLike {
  id: string;
  name?: string;
  description?: string;
}
interface ServerLike {
  id: string;
  name?: string;
}
interface LlmProfileLike {
  id: string;
  name?: string;
  models?: unknown[];
}

export interface LibrarySources {
  profiles: Map<string, ProfileLike[]>;
  skills: Map<string, SkillLike[]>;
  servers: Map<string, ServerLike[]>;
  llmProfiles: Map<string, LlmProfileLike[]>;
}

export interface LibraryFilter {
  tab: AgentsTab;
  backendFilter: 'all' | string;
}

function eachBackend<T>(map: Map<string, T[]>, cb: (backendId: string, item: T) => void) {
  for (const [backendId, items] of map) for (const item of items) cb(backendId, item);
}

export function buildLibraryItems(
  sources: LibrarySources,
  _backends: AgentsBackend[],
  filter: LibraryFilter
): LibraryItem[] {
  const out: LibraryItem[] = [];
  const wantKind = (k: LibraryItem['kind']) =>
    (filter.tab === 'profiles' && k === 'profile') ||
    (filter.tab === 'skills' && k === 'skill') ||
    (filter.tab === 'mcp-servers' && k === 'mcp-server') ||
    (filter.tab === 'providers' && k === 'llm-profile');

  if (wantKind('profile'))
    eachBackend(sources.profiles, (backendId, p) =>
      out.push({
        kind: 'profile',
        backendId,
        id: p.id,
        title: p.name ?? p.id,
        subtitle: p.model || (p.runtimeType === 'claude' ? 'Auto' : undefined),
        status: p.isDefault ? 'Default' : p.status === 'readonly' ? 'Read-only' : undefined,
      })
    );
  if (wantKind('skill'))
    eachBackend(sources.skills, (backendId, s) =>
      out.push({
        kind: 'skill',
        backendId,
        id: s.id,
        title: s.name ?? s.id,
        subtitle: s.description,
      })
    );
  if (wantKind('mcp-server'))
    eachBackend(sources.servers, (backendId, m) =>
      out.push({ kind: 'mcp-server', backendId, id: m.id, title: m.name ?? m.id })
    );
  if (wantKind('llm-profile'))
    eachBackend(sources.llmProfiles, (backendId, l) =>
      out.push({
        kind: 'llm-profile',
        backendId,
        id: l.id,
        title: l.name ?? l.id,
        subtitle: l.models ? `${l.models.length} models` : undefined,
      })
    );

  return filter.backendFilter === 'all'
    ? out
    : out.filter(i => i.backendId === filter.backendFilter);
}

export function useAgentsLibrary(
  sources: LibrarySources,
  backends: AgentsBackend[],
  filter: LibraryFilter
): LibraryItem[] {
  return useMemo(
    () => buildLibraryItems(sources, backends, filter),
    [sources, backends, filter.tab, filter.backendFilter]
  );
}
