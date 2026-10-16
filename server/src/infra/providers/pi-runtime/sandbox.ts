import * as os from 'os';
import { SandboxManager } from '@anthropic-ai/sandbox-runtime';
import type { SandboxRuntimeConfig } from '@anthropic-ai/sandbox-runtime';

import { scrubEnv } from './env-scrub.js';
import { expandHome, SENSITIVE_DENY_READ } from '../../../utils/sensitive-paths.js';

export { SENSITIVE_DENY_READ };

/** Non-secret files inside denied subtrees that tools still need (allow-within-deny). */
export const SENSITIVE_ALLOW_BACK: string[] = [
  '~/.ssh/config',
  '~/.ssh/known_hosts',
  '~/.ssh/known_hosts.old',
  '~/.ssh/*.pub',
  '~/.aws/config',
  '~/.config/gh/config.yml',
].map(expandHome);

/** Network allow-list (operator-overridable). Network is allow-only, so this MUST cover what the agent needs. */
export const DEFAULT_ALLOWED_DOMAINS: string[] = [
  'registry.npmjs.org',
  'registry.yarnpkg.com',
  'pypi.org',
  'files.pythonhosted.org',
  'crates.io',
  'static.crates.io',
  'proxy.golang.org',
  'sum.golang.org',
  'repo.maven.apache.org',
  'rubygems.org',
  'github.com',
  'api.github.com',
  'codeload.github.com',
  'raw.githubusercontent.com',
  'objects.githubusercontent.com',
  'gitlab.com',
  'bitbucket.org',
  'nodejs.org',
];

let cached: boolean | undefined;
let warned = false;
export function __resetSandboxCacheForTests(): void {
  cached = undefined;
  warned = false;
}

export function isSandboxAvailable(): boolean {
  if (cached !== undefined) return cached;
  if (process.env.ZCLAUDIA_SANDBOX === 'off') {
    cached = false;
    return cached;
  }
  try {
    const supported = SandboxManager.isSupportedPlatform();
    const deps = SandboxManager.checkDependencies?.() ?? {
      errors: [] as string[],
      warnings: [] as string[],
    };
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
    initPromise = SandboxManager.initialize(baseConfig()).catch(err => {
      console.warn('[sandbox] initialize failed; degrading to unavailable:', err);
      cached = false;
      initPromise = undefined;
    });
  }
  return initPromise;
}

export interface WrapOptions {
  workspaceRoot: string; // session project root (NOT the per-call cwd subdir)
  /** Project additional directories: writable like the workspace (never in readOnly mode). */
  additionalRoots?: readonly string[];
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
        allowWrite: opts.readOnly
          ? [tmpDir]
          : [opts.workspaceRoot, ...(opts.additionalRoots ?? []), tmpDir],
        denyRead: SENSITIVE_DENY_READ,
        denyWrite: [],
        allowRead: SENSITIVE_ALLOW_BACK,
      },
      network: {
        allowedDomains: [...DEFAULT_ALLOWED_DOMAINS, ...(opts.extraAllowedDomains ?? [])],
        deniedDomains: [],
      },
    };
    const wrapped = await SandboxManager.wrapWithSandboxArgv(
      command,
      undefined,
      customConfig,
      opts.signal
    );
    // The lib returns the full process.env (spike-confirmed; do NOT merge) —
    // scrub secret-looking names before handing it to the sandboxed child so
    // credentials are not exposed inside the sandbox's network allow-list.
    return {
      argv: wrapped.argv,
      env: wrapped.env ? scrubEnv(wrapped.env) : wrapped.env,
      sandboxed: true,
    };
  } catch (err) {
    console.warn('[sandbox] wrapCommand failed; degrading for this command:', err);
    return { sandboxed: false };
  }
}
