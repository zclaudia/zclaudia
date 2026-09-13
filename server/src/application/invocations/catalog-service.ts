import { createHash, createHmac, randomBytes } from 'node:crypto';
import {
  validateInvocationArgumentContract,
  type CatalogPhase,
  type InvocableCatalogSnapshot,
  type InvocableDescriptor,
  type InvocableDiagnostic,
  type PortableSkillAssessment,
  type PortableSkillCandidate,
  type RuntimeCatalogDelta,
  type RuntimeDiscoveryContext,
  type RuntimeInvocableCatalog,
  type RuntimeInvocableRecord,
  type RuntimeInvocationCapabilities,
} from '@zclaudia/shared/providers';

export const INVOCABLE_CATALOG_PROTOCOL_VERSION = 1 as const;

const DISCOVERY_TTL_MS = 30_000;
const SNAPSHOT_HISTORY_TTL_MS = 10 * 60_000;
const FINGERPRINT_SECRET = randomBytes(32);

export function stableInvocableId(input: {
  runtimeType: string;
  engineMode: string;
  kind: string;
  scope: string;
  providerLocalKey: string;
}): string {
  const hash = createHash('sha256');
  hash.update(
    `${input.runtimeType}\u0000${input.engineMode}\u0000${input.kind}\u0000${input.scope}\u0000${input.providerLocalKey}`
  );
  return `inv1:${hash.digest('base64url')}`;
}

export function publicDescriptorFromRecord(
  record: RuntimeInvocableRecord,
  context: { runtimeType: string; engineMode: string }
): InvocableDescriptor {
  return {
    ...record.descriptor,
    id: stableInvocableId({
      runtimeType: context.runtimeType,
      engineMode: context.engineMode,
      kind: record.descriptor.kind,
      scope: record.descriptor.origin.scope,
      providerLocalKey: record.providerLocalKey,
    }),
  };
}

export interface CatalogContextBinding {
  backendIdentity: string;
  sessionId: string;
  runtimeType: string;
  engineMode: string;
  canonicalCwd: string;
  canonicalRepositoryRoot?: string;
  configurationRootFingerprint: string;
  settingsSourcePolicy: readonly string[];
  catalogPhase: CatalogPhase;
  runtimeSessionEpoch?: string;
  catalogStateToken?: string;
}

export function contextFingerprint(binding: CatalogContextBinding): string {
  const canonical = [
    binding.backendIdentity,
    binding.sessionId,
    binding.runtimeType,
    binding.engineMode,
    binding.canonicalCwd,
    binding.canonicalRepositoryRoot ?? '',
    binding.configurationRootFingerprint,
    [...binding.settingsSourcePolicy].join(','),
    binding.catalogPhase,
    binding.runtimeSessionEpoch ?? '',
    binding.catalogStateToken ?? '',
  ].join('\u0001');
  return createHmac('sha256', FINGERPRINT_SECRET).update(canonical).digest('base64url');
}

export function sameContextIdentity(
  left: CatalogContextBinding,
  right: CatalogContextBinding
): boolean {
  return (
    left.backendIdentity === right.backendIdentity &&
    left.sessionId === right.sessionId &&
    left.runtimeType === right.runtimeType &&
    left.engineMode === right.engineMode &&
    left.canonicalCwd === right.canonicalCwd &&
    left.canonicalRepositoryRoot === right.canonicalRepositoryRoot &&
    left.configurationRootFingerprint === right.configurationRootFingerprint &&
    [...left.settingsSourcePolicy].join(',') === [...right.settingsSourcePolicy].join(',')
  );
}

export interface RuntimeCatalogSource {
  capabilities?(context: RuntimeDiscoveryContext): Promise<RuntimeInvocationCapabilities>;
  discover(context: RuntimeDiscoveryContext, signal: AbortSignal): Promise<RuntimeInvocableCatalog>;
  watch?(context: RuntimeDiscoveryContext, signal: AbortSignal): AsyncIterable<RuntimeCatalogDelta>;
  assessPortableSkill?(
    skill: PortableSkillCandidate,
    context: RuntimeDiscoveryContext,
    signal: AbortSignal
  ): Promise<PortableSkillAssessment>;
}

export interface PortableSkillEntry {
  descriptor: Omit<InvocableDescriptor, 'id'>;
  providerLocalKey: string;
  contentDigest: string;
  nativeLocator?: unknown;
  candidate?: PortableSkillCandidate;
  assessment?: PortableSkillAssessment;
}

export interface CatalogSnapshotRequest {
  backendIdentity: string;
  sessionId: string;
  runtimeType: string;
  engineMode: string;
  canonicalCwd: string;
  canonicalRepositoryRoot?: string;
  configurationRoots?: readonly string[];
  configurationRootFingerprint: string;
  settingsSourcePolicy: readonly string[];
  runtimeVersion?: string;
  adapterVersion: string;
  cliPath?: string;
  sessionPhase?: CatalogPhase;
  runtimeSessionEpoch?: string;
  catalogStateToken?: string;
  hostDescriptors: Array<Omit<InvocableDescriptor, 'id'>>;
  portableEntries: PortableSkillEntry[];
  runtimeSource: RuntimeCatalogSource;
  signal?: AbortSignal;
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

interface StoredSnapshot {
  snapshot: InvocableCatalogSnapshot;
  binding: CatalogContextBinding;
  records: Map<string, RuntimeInvocableRecord>;
  expiresAt: number;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.keys(value as Record<string, unknown>)
    .sort()
    .map(key => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`)
    .join(',')}}`;
}

function discoveryKey(request: CatalogSnapshotRequest, sessionScoped: boolean): string {
  return [
    request.backendIdentity,
    request.runtimeType,
    request.engineMode,
    request.runtimeVersion ?? '',
    request.adapterVersion,
    request.canonicalCwd,
    request.canonicalRepositoryRoot ?? '',
    request.configurationRootFingerprint,
    [...request.settingsSourcePolicy].join(','),
    sessionScoped ? request.sessionId : '',
    sessionScoped ? (request.runtimeSessionEpoch ?? '') : '',
    sessionScoped ? (request.catalogStateToken ?? '') : '',
  ].join('\u0001');
}

function historyKey(sessionId: string, revision: string, fingerprint: string): string {
  return `${sessionId}\u0000${revision}\u0000${fingerprint}`;
}

export class InvocableCatalogService {
  private readonly discoveryCache = new Map<string, CacheEntry<RuntimeInvocableCatalog>>();
  private readonly discoveryKeysBySession = new Map<string, Set<string>>();
  private readonly history = new Map<string, StoredSnapshot>();
  private readonly currentBySession = new Map<string, StoredSnapshot>();

  snapshotByRevision(
    sessionId: string,
    revision: string,
    fingerprint?: string
  ): InvocableCatalogSnapshot | undefined {
    return this.findStored(sessionId, revision, fingerprint)?.snapshot;
  }

  bindingByRevision(
    sessionId: string,
    revision: string,
    fingerprint?: string
  ): CatalogContextBinding | undefined {
    return this.findStored(sessionId, revision, fingerprint)?.binding;
  }

  recordFor(
    sessionId: string,
    revision: string,
    id: string,
    fingerprint?: string
  ): RuntimeInvocableRecord | undefined {
    return this.findStored(sessionId, revision, fingerprint)?.records.get(id);
  }

  currentBinding(sessionId: string): CatalogContextBinding | undefined {
    const stored = this.currentBySession.get(sessionId);
    if (!stored || stored.expiresAt <= Date.now()) return undefined;
    return stored.binding;
  }

  private findStored(
    sessionId: string,
    revision: string,
    fingerprint?: string
  ): StoredSnapshot | undefined {
    this.pruneHistory();
    if (fingerprint) return this.history.get(historyKey(sessionId, revision, fingerprint));
    for (const stored of this.history.values()) {
      if (stored.binding.sessionId === sessionId && stored.snapshot.revision === revision)
        return stored;
    }
    return undefined;
  }

  async getSnapshot(request: CatalogSnapshotRequest): Promise<InvocableCatalogSnapshot> {
    const now = Date.now();
    const initialContext = this.discoveryContext(request);
    let sessionScoped: boolean;
    try {
      const capabilities = await request.runtimeSource.capabilities?.(initialContext);
      sessionScoped = capabilities?.discoveryScope === 'session';
    } catch {
      sessionScoped = true;
    }

    const key = discoveryKey(request, sessionScoped);
    const sessionKeys = this.discoveryKeysBySession.get(request.sessionId) ?? new Set<string>();
    sessionKeys.add(key);
    this.discoveryKeysBySession.set(request.sessionId, sessionKeys);

    let runtimeCatalog = this.discoveryCache.get(key)?.value;
    const diagnostics: InvocableDiagnostic[] = [];
    if (!runtimeCatalog || (this.discoveryCache.get(key)?.expiresAt ?? 0) <= now) {
      try {
        runtimeCatalog = await request.runtimeSource.discover(
          initialContext,
          request.signal ?? new AbortController().signal
        );
        this.discoveryCache.set(key, {
          value: runtimeCatalog,
          expiresAt: now + DISCOVERY_TTL_MS,
        });
      } catch (error) {
        diagnostics.push({
          severity: 'error',
          code: 'INVOCATION_DISCOVERY_FAILED',
          message: error instanceof Error ? error.message : String(error),
          runtimeType: request.runtimeType,
        });
        runtimeCatalog = {
          items: [],
          diagnostics: [],
          phase: 'degraded',
          completeness: 'partial',
        };
      }
    }

    diagnostics.push(...runtimeCatalog.diagnostics);
    const binding = this.buildBinding(request, runtimeCatalog);
    const records = new Map<string, RuntimeInvocableRecord>();
    const invocables: InvocableDescriptor[] = [];

    const pushRecord = (
      record: RuntimeInvocableRecord,
      idContext: { runtimeType: string; engineMode: string } = request
    ): void => {
      const contractErrors = validateInvocationArgumentContract(
        record.descriptor.execution.arguments
      );
      if (contractErrors.length > 0) {
        diagnostics.push({
          severity: 'error',
          code: 'INVOCATION_ARGUMENT_CONTRACT_INVALID',
          message: contractErrors.join('; '),
          runtimeType: request.runtimeType,
        });
        return;
      }
      const descriptor = publicDescriptorFromRecord(record, idContext);
      records.set(descriptor.id, record);
      invocables.push(descriptor);
    };

    runtimeCatalog.items.forEach(record => pushRecord(record));
    for (const entry of request.portableEntries) {
      pushRecord({
        descriptor: entry.descriptor,
        providerLocalKey: entry.providerLocalKey,
        nativeLocator: entry.nativeLocator ?? {
          kind: 'portable-skill',
          digest: entry.contentDigest,
          candidate: entry.candidate,
          assessment: entry.assessment,
        },
        contentDigest: entry.contentDigest,
      });
    }
    for (const descriptor of request.hostDescriptors) {
      pushRecord(
        {
          descriptor,
          providerLocalKey: descriptor.name,
          nativeLocator: { kind: 'host-action', name: descriptor.name },
        },
        { runtimeType: 'host', engineMode: 'none' }
      );
    }

    const revision = this.revisionFor(invocables, records, runtimeCatalog);
    const snapshot: InvocableCatalogSnapshot = {
      protocolVersion: INVOCABLE_CATALOG_PROTOCOL_VERSION,
      revision,
      generatedAt: now,
      contextFingerprint: contextFingerprint(binding),
      phase: runtimeCatalog.phase,
      completeness: runtimeCatalog.completeness,
      invocables,
      diagnostics,
    };
    const stored: StoredSnapshot = {
      snapshot,
      binding,
      records,
      expiresAt: now + SNAPSHOT_HISTORY_TTL_MS,
    };
    this.history.set(historyKey(request.sessionId, revision, snapshot.contextFingerprint), stored);
    this.currentBySession.set(request.sessionId, stored);
    this.pruneHistory();
    return snapshot;
  }

  invalidateAll(): void {
    this.discoveryCache.clear();
    this.discoveryKeysBySession.clear();
    this.history.clear();
    this.currentBySession.clear();
  }

  invalidateSession(sessionId: string): void {
    for (const key of this.discoveryKeysBySession.get(sessionId) ?? []) {
      this.discoveryCache.delete(key);
    }
    this.discoveryKeysBySession.delete(sessionId);
    this.currentBySession.delete(sessionId);
  }

  private discoveryContext(request: CatalogSnapshotRequest): RuntimeDiscoveryContext {
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
        ...(request.runtimeSessionEpoch
          ? { runtimeSessionEpoch: request.runtimeSessionEpoch }
          : {}),
        ...(request.catalogStateToken ? { catalogStateToken: request.catalogStateToken } : {}),
      },
      ...(request.cliPath ? { cliPath: request.cliPath } : {}),
    };
  }

  private buildBinding(
    request: CatalogSnapshotRequest,
    runtimeCatalog: RuntimeInvocableCatalog
  ): CatalogContextBinding {
    const stateToken = [request.catalogStateToken, runtimeCatalog.runtimeRevision]
      .filter((value): value is string => !!value)
      .join('\u0000');
    return {
      backendIdentity: request.backendIdentity,
      sessionId: request.sessionId,
      runtimeType: request.runtimeType,
      engineMode: request.engineMode,
      canonicalCwd: request.canonicalCwd,
      ...(request.canonicalRepositoryRoot
        ? { canonicalRepositoryRoot: request.canonicalRepositoryRoot }
        : {}),
      configurationRootFingerprint: request.configurationRootFingerprint,
      settingsSourcePolicy: request.settingsSourcePolicy,
      catalogPhase: runtimeCatalog.phase,
      ...(runtimeCatalog.runtimeSessionEpoch || request.runtimeSessionEpoch
        ? {
            runtimeSessionEpoch: runtimeCatalog.runtimeSessionEpoch ?? request.runtimeSessionEpoch,
          }
        : {}),
      ...(stateToken ? { catalogStateToken: stateToken } : {}),
    };
  }

  private revisionFor(
    invocables: InvocableDescriptor[],
    records: Map<string, RuntimeInvocableRecord>,
    runtimeCatalog: RuntimeInvocableCatalog
  ): string {
    const hash = createHash('sha256');
    for (const descriptor of invocables) {
      hash.update(stableJson(descriptor));
      hash.update(`\u0000digest:${records.get(descriptor.id)?.contentDigest ?? ''}\u0001`);
    }
    hash.update(`phase:${runtimeCatalog.phase}`);
    hash.update(`completeness:${runtimeCatalog.completeness}`);
    hash.update(`runtimeRevision:${runtimeCatalog.runtimeRevision ?? ''}`);
    hash.update(`runtimeEpoch:${runtimeCatalog.runtimeSessionEpoch ?? ''}`);
    return `invcat_${hash.digest('base64url').slice(0, 27)}`;
  }

  private pruneHistory(): void {
    const now = Date.now();
    for (const [key, stored] of this.history) {
      if (stored.expiresAt <= now) this.history.delete(key);
    }
    for (const [sessionId, stored] of this.currentBySession) {
      if (stored.expiresAt <= now) this.currentBySession.delete(sessionId);
    }
  }
}
