import { createHash } from 'node:crypto';
import { dirname, relative, resolve, sep } from 'node:path';
import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import matter from 'gray-matter';
import type Database from 'better-sqlite3';
import { normalizeAgentRuntimeType } from '@zclaudia/shared/core/agent-profile';
import { resolveSkillSelection } from '@zclaudia/shared/core/skills';
import type {
  InvocationRequest,
  InvocableCatalogSnapshot,
  PortableSkillAssessment,
  PortableSkillCandidate,
  PortableSkillResourceEntry,
  RuntimeAttachment,
  RuntimeDiscoveryContext,
  RuntimeInvocableRecord,
} from '@zclaudia/shared/providers';
import { InvocationError } from '@zclaudia/shared/providers';
import { resolveAgentForSession } from '../../domains/agent-profiles/agent-resolver.js';
import { normalizedProfileEngineMode } from '../../domains/agent-profiles/engine-mode.js';
import type { ProviderRegistryPort } from '../../infra/providers/registry.js';
import { getBackendRouteId } from '../../infra/push/notification-context.js';
import {
  getEligibleDiscoveredSkills,
  loadDiscoveredSkillContent,
  type DiscoveredSkill,
} from '../plugins/skill-tools.js';
import {
  InvocableCatalogService,
  type CatalogSnapshotRequest,
  type PortableSkillEntry,
} from './catalog-service.js';
import { hostActionRegistry } from './host-actions.js';
import { registerDesktopHostActions } from './host-actions-desktop.js';
import { resolveInvocation, type InvocationResolution } from './router.js';

const MAX_RESOURCE_FILES = 256;
const MAX_RESOURCE_BYTES = 10 * 1024 * 1024;

interface SessionCatalogRow {
  id: string;
  agent_profile_id: string | null;
  working_directory: string | null;
  root_path: string | null;
  sdk_session_id: string | null;
  provider_transport: string | null;
}

export interface PortableSkillLocator {
  kind: 'portable-skill';
  source: DiscoveredSkill['source'];
  id: string;
  filePath: string;
  trustedRoot: string;
  expectedDigest: string;
  candidate: PortableSkillCandidate;
  assessment: PortableSkillAssessment;
}

export const sessionInvocableCatalogService = new InvocableCatalogService();

function digest(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('base64url');
}

function discoveryContext(request: CatalogSnapshotRequest): RuntimeDiscoveryContext {
  return {
    runtimeType: request.runtimeType,
    engineMode: request.engineMode,
    ...(request.runtimeVersion ? { runtimeVersion: request.runtimeVersion } : {}),
    adapterVersion: request.adapterVersion,
    canonicalCwd: request.canonicalCwd,
    ...(request.canonicalRepositoryRoot
      ? { canonicalRepositoryRoot: request.canonicalRepositoryRoot }
      : {}),
    configurationRoots: request.configurationRoots ?? [request.canonicalCwd],
    settingsSourcePolicy: request.settingsSourcePolicy,
    configurationRootFingerprint: request.configurationRootFingerprint,
    session: {
      id: request.sessionId,
      phase: request.sessionPhase ?? 'bootstrap',
      ...(request.runtimeSessionEpoch ? { runtimeSessionEpoch: request.runtimeSessionEpoch } : {}),
      ...(request.catalogStateToken ? { catalogStateToken: request.catalogStateToken } : {}),
    },
    ...(request.cliPath ? { cliPath: request.cliPath } : {}),
  };
}

function portableScope(source: DiscoveredSkill['source']): 'project' | 'user' | 'system' {
  if (source === 'workspace') return 'project';
  if (source === 'plugin') return 'system';
  return 'user';
}

function portableOwner(source: DiscoveredSkill['source']): 'project' | 'user' | 'plugin' {
  if (source === 'workspace') return 'project';
  if (source === 'plugin') return 'plugin';
  return 'user';
}

async function collectResourceManifest(skill: DiscoveredSkill): Promise<{
  entries: PortableSkillResourceEntry[];
  complete: boolean;
}> {
  const entries: PortableSkillResourceEntry[] = [];
  let totalBytes = 0;
  const visit = async (directory: string): Promise<boolean> => {
    const children = await readdir(directory, { withFileTypes: true });
    children.sort((left, right) => left.name.localeCompare(right.name));
    for (const child of children) {
      const absolute = resolve(directory, child.name);
      if (child.isSymbolicLink()) continue;
      if (child.isDirectory()) {
        if (!(await visit(absolute))) return false;
        continue;
      }
      if (!child.isFile() || absolute === resolve(skill.filePath)) continue;
      const info = await stat(absolute);
      totalBytes += info.size;
      if (entries.length >= MAX_RESOURCE_FILES || totalBytes > MAX_RESOURCE_BYTES) return false;
      const content = await readFile(absolute);
      entries.push({
        relativePath: relative(skill.dirPath, absolute).split(sep).join('/'),
        size: info.size,
        contentDigest: digest(content),
      });
    }
    return true;
  };
  try {
    return { entries, complete: await visit(skill.dirPath) };
  } catch {
    return { entries, complete: false };
  }
}

async function buildPortableEntry(
  skill: DiscoveredSkill,
  request: CatalogSnapshotRequest
): Promise<PortableSkillEntry | null> {
  if (skill.metadata?.userInvocable === false) return null;
  const content = await loadDiscoveredSkillContent({ source: skill.source, id: skill.id });
  if (content === null) return null;
  const contentDigest = digest(content);
  const resources = await collectResourceManifest(skill);
  const candidate: PortableSkillCandidate = {
    id: `${skill.source}:${skill.id}`,
    name: skill.name || skill.id,
    description: skill.description || '',
    metadata: {
      source: skill.source,
      ...(skill.metadata ?? {}),
      ...(skill.execution ? { execution: skill.execution } : {}),
    },
    ...(skill.requirements ? { requirements: skill.requirements as Record<string, unknown> } : {}),
    resourceManifest: resources.entries,
    contentDigest,
  };

  let assessment: PortableSkillAssessment;
  if (!resources.complete) {
    assessment = {
      supported: false,
      mode: 'unsupported',
      code: 'PORTABLE_SKILL_RESOURCE_UNAVAILABLE',
      reason: 'The skill resource manifest exceeds host safety limits or cannot be read.',
    };
  } else if (!request.runtimeSource.assessPortableSkill) {
    assessment = {
      supported: false,
      mode: 'unsupported',
      code: 'PORTABLE_SKILL_UNSUPPORTED',
      reason: 'The active runtime does not support portable skills.',
    };
  } else {
    try {
      assessment = await request.runtimeSource.assessPortableSkill(
        candidate,
        discoveryContext(request),
        request.signal ?? new AbortController().signal
      );
      if (assessment.supported && assessment.resourceAccess !== 'none') {
        assessment = {
          supported: false,
          mode: 'unsupported',
          code: 'PORTABLE_SKILL_RESOURCE_UNAVAILABLE',
          reason: 'Portable skill resource handles are not available on this host transport.',
        };
      }
    } catch (error) {
      assessment = {
        supported: false,
        mode: 'unsupported',
        code: 'PORTABLE_SKILL_UNSUPPORTED',
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  const execution = assessment.supported
    ? {
        mode: assessment.executionMode,
        fidelity: assessment.fidelity,
      }
    : { mode: 'emulated' as const, fidelity: 'best-effort' as const };
  const locator: PortableSkillLocator = {
    kind: 'portable-skill',
    source: skill.source,
    id: skill.id,
    filePath: skill.filePath,
    trustedRoot: skill.dirPath,
    expectedDigest: contentDigest,
    candidate,
    assessment,
  };
  return {
    descriptor: {
      kind: 'portable.skill',
      runtimeType: request.runtimeType,
      name: skill.id,
      label: skill.name || skill.id,
      ...(skill.description ? { description: skill.description } : {}),
      displayTrigger: `/skill:${skill.id}`,
      ...(skill.metadata?.argumentHint ? { argumentHint: skill.metadata.argumentHint } : {}),
      origin: { owner: portableOwner(skill.source), scope: portableScope(skill.source) },
      execution: {
        ...execution,
        arguments: {
          accepted: ['raw'],
          preferred: 'raw',
          transcript: { raw: 'verbatim' },
        },
      },
      availability: assessment.supported
        ? { available: true }
        : {
            available: false,
            reason: assessment.reason,
            code: assessment.code,
          },
    },
    providerLocalKey: `${skill.source}:${skill.id}`,
    contentDigest,
    nativeLocator: locator,
    candidate,
    assessment,
  };
}

export async function buildSessionCatalogRequest(
  db: Database.Database,
  sessionId: string,
  registry: ProviderRegistryPort
): Promise<CatalogSnapshotRequest | null> {
  registerDesktopHostActions();
  const row = db
    .prepare(
      `SELECT s.id, s.agent_profile_id, s.working_directory, s.sdk_session_id,
              s.provider_transport, p.root_path
       FROM sessions s
       LEFT JOIN projects p ON p.id = s.project_id
       WHERE s.id = ?`
    )
    .get(sessionId) as SessionCatalogRow | undefined;
  if (!row) return null;

  const { agent } = resolveAgentForSession(db, {
    explicitAgentId: row.agent_profile_id ?? undefined,
    sessionId,
  });
  const runtimeType = normalizeAgentRuntimeType(agent.runtimeType);
  const engineMode = normalizedProfileEngineMode(agent);
  const adapter = registry.get(runtimeType);
  const canonicalRepositoryRoot = row.root_path ? resolve(row.root_path) : undefined;
  const canonicalCwd = resolve(row.working_directory || canonicalRepositoryRoot || process.cwd());
  const configurationRoots = [
    ...new Set([canonicalCwd, canonicalRepositoryRoot].filter(Boolean)),
  ] as string[];
  const settingsSourcePolicy = ['user', 'project'] as const;
  const configurationRootFingerprint = digest(
    JSON.stringify({ configurationRoots, settingsSourcePolicy })
  );
  const runtimeSource =
    adapter?.invocations ??
    ({
      discover: async () => ({
        items: [],
        diagnostics: [
          {
            severity: 'info' as const,
            code: 'RUNTIME_CATALOG_UNSUPPORTED',
            message: 'The active runtime does not publish an invocable catalog.',
            runtimeType,
          },
        ],
        phase: 'live' as const,
        completeness: 'complete' as const,
      }),
    } as const);

  const base: CatalogSnapshotRequest = {
    backendIdentity: getBackendRouteId(db) ?? 'local-standalone',
    sessionId,
    runtimeType,
    engineMode,
    canonicalCwd,
    ...(canonicalRepositoryRoot ? { canonicalRepositoryRoot } : {}),
    configurationRoots,
    configurationRootFingerprint,
    settingsSourcePolicy,
    adapterVersion: adapter?.manifest?.version ?? 'unknown',
    ...(agent.cliPath ? { cliPath: agent.cliPath } : {}),
    sessionPhase: row.sdk_session_id ? 'live' : 'bootstrap',
    ...(row.sdk_session_id ? { runtimeSessionEpoch: row.sdk_session_id } : {}),
    catalogStateToken: digest(`${row.provider_transport ?? ''}\u0000${row.sdk_session_id ?? ''}`),
    hostDescriptors: hostActionRegistry.descriptors(),
    portableEntries: [],
    runtimeSource,
  };

  const discovered = getEligibleDiscoveredSkills();
  const visible = resolveSkillSelection(discovered, agent.skillSelection).discoverable;
  const portableEntries = (
    await Promise.all(visible.map(skill => buildPortableEntry(skill, base)))
  ).filter((entry): entry is PortableSkillEntry => entry !== null);
  return { ...base, portableEntries };
}

export async function getSessionInvocableSnapshot(
  db: Database.Database,
  sessionId: string,
  registry: ProviderRegistryPort
): Promise<InvocableCatalogSnapshot | null> {
  registerDesktopHostActions();
  const request = await buildSessionCatalogRequest(db, sessionId, registry);
  return request ? sessionInvocableCatalogService.getSnapshot(request) : null;
}

function isPortableLocator(value: unknown): value is PortableSkillLocator {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as { kind?: unknown }).kind === 'portable-skill' &&
    typeof (value as { filePath?: unknown }).filePath === 'string'
  );
}

async function materializePortableSkill(record: RuntimeInvocableRecord) {
  if (!isPortableLocator(record.nativeLocator)) {
    throw new InvocationError('INVOCATION_PREPARE_FAILED', 'Portable skill locator is invalid.');
  }
  const locator = record.nativeLocator;
  const [resolvedFile, resolvedRoot] = await Promise.all([
    realpath(locator.filePath),
    realpath(locator.trustedRoot),
  ]);
  const relativePath = relative(resolvedRoot, resolvedFile);
  if (
    relativePath.startsWith(`..${sep}`) ||
    relativePath === '..' ||
    resolve(dirname(resolvedFile)) !== resolvedRoot
  ) {
    throw new InvocationError(
      'PORTABLE_SKILL_RESOURCE_UNAVAILABLE',
      'Portable skill path is outside its trusted root.'
    );
  }
  const content = await loadDiscoveredSkillContent({ source: locator.source, id: locator.id });
  if (content === null) {
    throw new InvocationError(
      'INVOCATION_PREPARE_FAILED',
      'Portable skill is no longer available.'
    );
  }
  const currentDigest = digest(content);
  if (currentDigest !== locator.expectedDigest || currentDigest !== record.contentDigest) {
    throw new InvocationError(
      'PORTABLE_SKILL_CHANGED',
      'The portable skill changed after selection; refresh the catalog.'
    );
  }
  const parsed = matter(content);
  return {
    id: locator.candidate.id,
    name: locator.candidate.name,
    description: locator.candidate.description,
    body: parsed.content.trim(),
    metadata: locator.candidate.metadata,
    contentDigest: currentDigest,
  };
}

export async function resolveSessionInvocation(
  db: Database.Database,
  sessionId: string,
  registry: ProviderRegistryPort,
  request: InvocationRequest,
  attachments?: RuntimeAttachment[]
): Promise<InvocationResolution> {
  // Execution is a trust boundary: bypass the short discovery TTL so file and
  // runtime changes between autocomplete selection and send are observed.
  sessionInvocableCatalogService.invalidateSession(sessionId);
  const snapshot = await getSessionInvocableSnapshot(db, sessionId, registry);
  if (!snapshot) throw new InvocationError('INVOCATION_NOT_FOUND', 'Session not found.');
  const binding = sessionInvocableCatalogService.currentBinding(sessionId);
  if (!binding) {
    throw new InvocationError('INVOCATION_CATALOG_STALE', 'Session catalog is unavailable.');
  }
  return resolveInvocation(request, {
    currentBinding: binding,
    currentSnapshot: snapshot,
    snapshotByRevision: (revision, fingerprint) =>
      sessionInvocableCatalogService.snapshotByRevision(sessionId, revision, fingerprint),
    bindingByRevision: (revision, fingerprint) =>
      sessionInvocableCatalogService.bindingByRevision(sessionId, revision, fingerprint),
    recordFor: (id, revision, fingerprint) =>
      sessionInvocableCatalogService.recordFor(sessionId, revision, id, fingerprint),
    assessPortableSkill: (_descriptor, record) => {
      if (!isPortableLocator(record.nativeLocator)) return undefined;
      return record.nativeLocator.assessment;
    },
    materializePortableSkill: async (_descriptor, _arguments, record) =>
      materializePortableSkill(record),
    ...(attachments?.length ? { attachments } : {}),
  });
}
