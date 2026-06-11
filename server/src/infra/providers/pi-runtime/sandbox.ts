import * as os from 'os';
import * as path from 'path';
import { SandboxManager } from '@anthropic-ai/sandbox-runtime';
import type { SandboxRuntimeConfig } from '@anthropic-ai/sandbox-runtime';

/** Expand a leading `~/` to an absolute home path (silent non-match = no protection; we don't rely on the lib's ~ handling). */
function expandHome(p: string): string {
  return p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p;
}

/** Credential paths to deny-read (operator-overridable default; spec §4). Pre-expanded to absolute. */
export const SENSITIVE_DENY_READ: string[] = [
  '~/.ssh', '~/.gnupg', '~/.aws/credentials', '~/.config/gcloud', '~/.azure',
  '~/.docker/config.json', '~/.kube/config', '~/.config/gh/hosts.yml',
  '~/.npmrc', '~/.pypirc', '~/.cargo/credentials.toml',
  '~/.netrc', '~/.vault-token', '~/.terraformrc',
  '~/.bash_history', '~/.zsh_history', '~/.zhistory',
  '~/Library/Safari', '~/Library/Application Support/Google/Chrome',
  '~/Library/Application Support/Firefox/Profiles',
].map(expandHome);

/** Non-secret files inside denied subtrees that tools still need (allow-within-deny). */
export const SENSITIVE_ALLOW_BACK: string[] = [
  '~/.ssh/config', '~/.ssh/known_hosts', '~/.ssh/known_hosts.old', '~/.ssh/*.pub',
  '~/.aws/config', '~/.config/gh/config.yml',
].map(expandHome);

/** Network allow-list (operator-overridable). Network is allow-only, so this MUST cover what the agent needs. */
export const DEFAULT_ALLOWED_DOMAINS: string[] = [
  'registry.npmjs.org', 'registry.yarnpkg.com',
  'pypi.org', 'files.pythonhosted.org',
  'crates.io', 'static.crates.io',
  'proxy.golang.org', 'sum.golang.org',
  'repo.maven.apache.org', 'rubygems.org',
  'github.com', 'api.github.com', 'codeload.github.com',
  'raw.githubusercontent.com', 'objects.githubusercontent.com',
  'gitlab.com', 'bitbucket.org',
  'nodejs.org',
];

let cached: boolean | undefined;
let warned = false;
export function __resetSandboxCacheForTests(): void { cached = undefined; warned = false; }

export function isSandboxAvailable(): boolean {
  if (cached !== undefined) return cached;
  if (process.env.ZCLAUDIA_SANDBOX === 'off') { cached = false; return cached; }
  try {
    const supported = SandboxManager.isSupportedPlatform();
    const deps = SandboxManager.checkDependencies?.() ?? { errors: [] as string[], warnings: [] as string[] };
    const ok = supported && (deps.errors?.length ?? 0) === 0;
    if (!ok && !warned) {
      warned = true;
      const missing = (deps.errors ?? []).join(', ') || 'unsupported platform';
      console.warn(`[sandbox] Bash sandbox unavailable: ${missing}. Commands run unsandboxed.`);
    }
    cached = ok;
  } catch {
    cached = false;
  }
  return cached;
}

/** Full, valid base config (initialize() rejects {}); real per-spawn policy overrides via customConfig in Task 3. */
function baseConfig(): SandboxRuntimeConfig {
  return {
    network: { allowedDomains: DEFAULT_ALLOWED_DOMAINS, deniedDomains: [] },
    filesystem: {
      denyRead: SENSITIVE_DENY_READ,
      allowWrite: [os.tmpdir()],
      denyWrite: [],
      allowRead: SENSITIVE_ALLOW_BACK,
    },
  };
}

let initPromise: Promise<void> | undefined;
export async function ensureSandboxInitialized(): Promise<void> {
  if (!isSandboxAvailable()) return;
  if (!initPromise) {
    initPromise = SandboxManager.initialize(baseConfig(), undefined, true).catch((err) => {
      console.warn('[sandbox] initialize failed; degrading to unavailable:', err);
      cached = false;
      initPromise = undefined;
    });
  }
  return initPromise;
}

export interface WrapOptions {
  workspaceRoot: string;   // session project root (NOT the per-call cwd subdir)
  readOnly?: boolean;
  /** Session-granted domains (Phase B1) appended to the network allow-list for this call. */
  extraAllowedDomains?: string[];
  signal?: AbortSignal;
}
export interface WrapResult {
  argv?: string[];
  env?: NodeJS.ProcessEnv;
  sandboxed: boolean;
}

export async function wrapCommand(command: string, opts: WrapOptions): Promise<WrapResult> {
  if (!isSandboxAvailable()) return { sandboxed: false };
  try {
    await ensureSandboxInitialized();
    if (!isSandboxAvailable()) return { sandboxed: false }; // init may have downgraded
    const tmpDir = os.tmpdir();
    const customConfig: Partial<SandboxRuntimeConfig> = {
      filesystem: {
        allowWrite: opts.readOnly ? [tmpDir] : [opts.workspaceRoot, tmpDir],
        denyRead: SENSITIVE_DENY_READ,
        denyWrite: [],
        allowRead: SENSITIVE_ALLOW_BACK,
      },
      network: {
        allowedDomains: [...DEFAULT_ALLOWED_DOMAINS, ...(opts.extraAllowedDomains ?? [])],
        deniedDomains: [],
      },
    };
    const wrapped = await SandboxManager.wrapWithSandboxArgv(command, undefined, customConfig, opts.signal);
    // env is already the full process.env — use as-is (spike-confirmed; do NOT merge).
    return { argv: wrapped.argv, env: wrapped.env, sandboxed: true };
  } catch (err) {
    console.warn('[sandbox] wrapCommand failed; degrading for this command:', err);
    return { sandboxed: false };
  }
}

/**
 * Phase B1 spoof guard: returns true if the runtime recorded a sandbox
 * violation for this command (corroborating a real block). Best-effort and
 * macOS-only — returns true (no veto) when the violation store is unavailable,
 * so callers degrade to copy-only mitigation rather than failing closed.
 */
export function sandboxViolationsLikelyForCommand(command: string): boolean {
  if (!isSandboxAvailable()) return true;
  try {
    const store = SandboxManager.getSandboxViolationStore?.();
    if (!store) return true;
    if (typeof store.getViolationsForCommand === 'function') {
      return store.getViolationsForCommand(command).length > 0 || store.getTotalCount() > 0;
    }
    return true;
  } catch {
    return true;
  }
}
