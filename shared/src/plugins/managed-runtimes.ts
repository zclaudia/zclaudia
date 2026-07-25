/**
 * Public, provider-neutral contract for host-managed Agent CLI runtimes.
 *
 * Plugins may declare this metadata in runtime-compatibility.json, but only the
 * trusted host reads it, downloads artifacts, and resolves executable paths.
 */

export const MANAGED_RUNTIME_POLICIES = ['system-only', 'managed-ask', 'managed-auto'] as const;
export type ManagedRuntimePolicy = (typeof MANAGED_RUNTIME_POLICIES)[number];

export const MANAGED_RUNTIME_PLATFORM_KEYS = [
  'darwin-arm64',
  'darwin-x64',
  'linux-x64',
  'linux-arm64',
  'win32-x64',
] as const;
export type ManagedRuntimePlatformKey = (typeof MANAGED_RUNTIME_PLATFORM_KEYS)[number];

export type ManagedRuntimeArchiveFormat = 'raw' | 'zip' | 'tar.gz';

export interface RuntimeExecutableDescriptor {
  command: string;
  versionArgs: string[];
  versionPattern?: string;
}

export interface RuntimeVersionPolicy {
  minimum?: string;
  testedMaximum?: string;
  knownIncompatible?: string[];
}

export interface RuntimeProbeDescriptor {
  kind: 'command' | 'json-rpc';
  args: string[];
  timeoutMs?: number;
}

export interface ManagedRuntimeAuthProbe {
  args: string[];
  timeoutMs?: number;
  successExitCodes?: number[];
  authenticatedPattern?: string;
  unauthenticatedPattern?: string;
}

export interface ManagedRuntimeSignature {
  algorithm: 'ed25519';
  /** PEM-encoded public key supplied by a trusted catalog or trusted plugin package. */
  publicKey: string;
  /** Base64 detached signature over the downloaded artifact bytes. */
  value: string;
}

export interface ManagedRuntimeProvenance {
  url: string;
  sha256: string;
  predicateType?: string;
}

export interface ManagedRuntimeArtifact {
  url: string;
  sha256: string;
  archiveFormat: ManagedRuntimeArchiveFormat;
  /** Executable path relative to the extracted platform directory. */
  executablePath: string;
  /** Optional expected download size shown before installation and enforced when present. */
  size?: number;
  signature?: ManagedRuntimeSignature;
  provenance?: ManagedRuntimeProvenance;
}

export interface ManagedRuntimeVersion {
  version: string;
  artifacts: Partial<Record<ManagedRuntimePlatformKey, ManagedRuntimeArtifact>>;
  authProbe?: ManagedRuntimeAuthProbe;
}

export interface ManagedInstallDescriptor {
  recommendedVersion?: string;
  versions: ManagedRuntimeVersion[];
  authProbe?: ManagedRuntimeAuthProbe;
}

export interface RuntimeCompatibilityDescriptor {
  schemaVersion: 1;
  runtime: string;
  executable: RuntimeExecutableDescriptor;
  versionPolicy?: RuntimeVersionPolicy;
  probe: RuntimeProbeDescriptor;
  managedInstall?: ManagedInstallDescriptor;
  /** Provider-specific test/distribution fields remain opaque to the host resolver. */
  live?: Record<string, unknown>;
  distribution?: Record<string, unknown>;
}

export type ManagedRuntimeCompatibilityState =
  | 'compatible'
  | 'missing'
  | 'too-old'
  | 'known-incompatible'
  | 'untested-newer'
  | 'unparseable'
  | 'probe-failed'
  | 'not-declared';

export type ManagedRuntimeAuthState =
  | 'authenticated'
  | 'auth-required'
  | 'unknown'
  | 'probe-failed';

export type ManagedRuntimeResolutionStatus =
  | 'resolved'
  | 'needs-approval'
  | 'managed-artifact-unavailable'
  | 'system-only'
  | 'auth-required'
  | 'blocked';

export type ManagedRuntimeSource = 'explicit' | 'system' | 'managed';

export interface ManagedRuntimeVerification {
  sha256?: string;
  checksumVerified: boolean;
  signatureVerified?: boolean;
  provenanceVerified?: boolean;
  verifiedAt?: string;
  sourceUrl?: string;
  size?: number;
  storagePath?: string;
}

export interface ManagedRuntimeArtifactSummary {
  pluginId: string;
  pluginVersion: string;
  runtime: string;
  version: string;
  platform: ManagedRuntimePlatformKey;
  url: string;
  sha256: string;
  archiveFormat: ManagedRuntimeArchiveFormat;
  executablePath: string;
  size?: number;
  signatureDeclared: boolean;
  provenanceDeclared: boolean;
  trustedForAuto: boolean;
}

export interface ManagedRuntimeResolution {
  status: ManagedRuntimeResolutionStatus;
  executablePath?: string;
  version?: string;
  source?: ManagedRuntimeSource;
  compatibilityState: ManagedRuntimeCompatibilityState;
  authState: ManagedRuntimeAuthState;
  verification: ManagedRuntimeVerification;
  artifact?: ManagedRuntimeArtifactSummary;
  warning?: string;
  message?: string;
  pluginId?: string;
  pluginVersion?: string;
  runtime: string;
}

export interface ManagedRuntimeResolveRequest {
  runtime: string;
  explicitPath?: string;
  /** A headless caller cannot satisfy managed-ask in-process. */
  headless?: boolean;
}

export interface ManagedRuntimesAPI {
  /**
   * Resolve a CLI owned by the calling plugin. The host applies global policy,
   * trust, compatibility, and verification rules; plugins cannot supply URLs.
   */
  resolve(request: ManagedRuntimeResolveRequest): Promise<ManagedRuntimeResolution>;
}
