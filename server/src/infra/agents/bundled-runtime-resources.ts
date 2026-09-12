import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

/**
 * Bundled runtime engine resources (design: Claude §8.1, Codex §8).
 *
 * SDK engine modes must run the executable delivered with the application —
 * never fall back to PATH, the managed CLI store, or a user's own install.
 * The host resolves and verifies the resource before every SDK run and hands
 * the absolute path to the plugin; a missing/incompatible resource is a hard
 * error (`SDK_ENGINE_UNAVAILABLE` / `BUNDLED_ENGINE_UNAVAILABLE`).
 *
 * Resolution is driven from the installed plugin directory so dev checkouts
 * (node_modules layout) and staged bundles (portable node_modules) behave
 * identically. The plugin-dir provider is injected by the application layer
 * (plugin loader) — this module stays free of application imports.
 */

export interface BundledRuntimeResource {
  executablePath: string;
  kind: 'bundled-sdk' | 'bundled-engine';
  /** Engine version as recorded by the resource package (best effort). */
  version?: string;
}

export type BundledRuntimeResourceErrorCode =
  | 'SDK_ENGINE_UNAVAILABLE'
  | 'BUNDLED_ENGINE_UNAVAILABLE';

export type BundledRuntimeResourceResolution =
  | ({ available: true } & BundledRuntimeResource)
  | { available: false; reason: string; code: BundledRuntimeResourceErrorCode };

type PluginDirProvider = (runtimeType: string) => string | undefined;

let pluginDirProvider: PluginDirProvider | undefined;

/** Wire the resource resolver to the plugin loader (called once at composition). */
export function configureBundledRuntimeResolver(provider: PluginDirProvider | undefined): void {
  pluginDirProvider = provider;
}

function platformDir(): string {
  return `${process.platform}-${process.arch}`;
}

function executableName(base: string): string {
  return process.platform === 'win32' ? `${base}.exe` : base;
}

function readPackageVersion(packageJsonPath: string): string | undefined {
  try {
    const parsed = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { version?: string };
    return typeof parsed.version === 'string' ? parsed.version : undefined;
  } catch {
    return undefined;
  }
}

function resolveClaudeSdkResource(pluginDir: string): BundledRuntimeResourceResolution {
  // Env override exists for tests and canary runs that inject a fixture engine.
  const override = process.env.ZCLAUDIA_BUNDLED_CLAUDE_SDK_EXECUTABLE;
  if (override) {
    if (!existsSync(override)) {
      return {
        available: false,
        reason: `ZCLAUDIA_BUNDLED_CLAUDE_SDK_EXECUTABLE does not exist: ${override}`,
        code: 'SDK_ENGINE_UNAVAILABLE',
      };
    }
    return { available: true, executablePath: override, kind: 'bundled-sdk' };
  }

  let requireFromPlugin: NodeJS.Require;
  try {
    requireFromPlugin = createRequire(path.join(pluginDir, 'package.json'));
  } catch (error) {
    return {
      available: false,
      reason: `Plugin directory unusable: ${pluginDir} (${String(error)})`,
      code: 'SDK_ENGINE_UNAVAILABLE',
    };
  }

  let sdkDir: string;
  try {
    // The SDK's exports map does not expose ./package.json — resolve the main
    // module and step up to the package directory.
    sdkDir = path.dirname(requireFromPlugin.resolve('@anthropic-ai/claude-agent-sdk'));
  } catch {
    return {
      available: false,
      reason: 'The Claude Agent SDK is not installed alongside the Claude plugin',
      code: 'SDK_ENGINE_UNAVAILABLE',
    };
  }
  const version = readPackageVersion(path.join(sdkDir, 'package.json'));
  const packageRoot = path.dirname(sdkDir);

  // The engine binary ships in the platform-specific optional package of the
  // SDK. Layouts differ per package manager / install stage: the platform
  // package is a pnpm SIBLING of the SDK package (dev), nested under the SDK's
  // own node_modules (npm-style), or hoisted next to the plugin (staged bundle).
  const platformPackage = `@anthropic-ai/claude-agent-sdk-${platformDir()}`;
  const platformBinary = executableName('claude');
  const candidates: string[] = [];
  try {
    candidates.push(
      path.join(
        path.dirname(requireFromPlugin.resolve(`${platformPackage}/package.json`)),
        platformBinary
      )
    );
  } catch {
    // Optional package not linked as a resolvable dependency.
  }
  candidates.push(
    // pnpm sibling: <...>/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64
    path.join(packageRoot, `claude-agent-sdk-${platformDir()}`, platformBinary),
    // npm-style nested: <sdk>/node_modules/@anthropic-ai/<platform-package>
    path.join(sdkDir, 'node_modules', platformPackage, platformBinary),
    // staged portable bundle: <plugin>/node_modules/@anthropic-ai/<platform-package>
    path.join(sdkDir, platformBinary)
  );

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return { available: true, executablePath: candidate, kind: 'bundled-sdk', version };
    }
  }
  return {
    available: false,
    reason: `No Claude SDK engine executable for ${platformDir()} (looked in ${sdkDir}); the SDK platform package for this platform is not installed`,
    code: 'SDK_ENGINE_UNAVAILABLE',
  };
}

function resolveCodexEngineResource(pluginDir: string): BundledRuntimeResourceResolution {
  const override = process.env.ZCLAUDIA_BUNDLED_CODEX_ENGINE_EXECUTABLE;
  if (override) {
    if (!existsSync(override)) {
      return {
        available: false,
        reason: `ZCLAUDIA_BUNDLED_CODEX_ENGINE_EXECUTABLE does not exist: ${override}`,
        code: 'BUNDLED_ENGINE_UNAVAILABLE',
      };
    }
    return { available: true, executablePath: override, kind: 'bundled-engine' };
  }

  // The release pipeline stages the official Codex runtime payload for the
  // target platform under <plugin>/engine/<platform-arch>/ (full payload —
  // auxiliary sandbox/shell components included, never a lone binary copy).
  const engineDir = path.join(pluginDir, 'engine', platformDir());
  const candidates = [
    path.join(engineDir, 'bin', executableName('codex')),
    path.join(engineDir, executableName('codex')),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      try {
        const manifest = JSON.parse(readFileSync(path.join(engineDir, 'manifest.json'), 'utf8'));
        const compatibility = JSON.parse(
          readFileSync(path.join(pluginDir, 'runtime-compatibility.json'), 'utf8')
        );
        const version = compatibility.bundledRuntime?.version;
        const artifact = compatibility.managedInstall?.versions.find(
          (v: { version: string }) => v.version === version
        )?.artifacts[platformDir()];
        if (
          !artifact ||
          manifest.version !== version ||
          manifest.platform !== platformDir() ||
          manifest.archiveSha256 !== artifact.sha256 ||
          manifest.executablePath !== artifact.executablePath ||
          path.resolve(engineDir, manifest.executablePath) !== candidate ||
          createHash('sha256').update(readFileSync(candidate)).digest('hex') !==
            manifest.executableSha256
        ) {
          throw new Error('Bundled engine identity or checksum does not match its pinned artifact');
        }
        return { available: true, executablePath: candidate, kind: 'bundled-engine', version };
      } catch (error) {
        return {
          available: false,
          code: 'BUNDLED_ENGINE_UNAVAILABLE',
          reason: `Bundled Codex verification failed: ${String(error)}`,
        };
      }
    }
  }
  return {
    available: false,
    reason: `No bundled Codex engine for ${platformDir()} (looked in ${engineDir}); the engine payload for this platform is not part of this installation`,
    code: 'BUNDLED_ENGINE_UNAVAILABLE',
  };
}

/** Resolve a bundled engine resource from a known plugin directory. */
export function resolveBundledRuntimeResourceFromPluginDir(
  runtimeType: string,
  pluginDir: string
): BundledRuntimeResourceResolution {
  switch (runtimeType) {
    case 'claude':
      return resolveClaudeSdkResource(pluginDir);
    case 'codex':
      return resolveCodexEngineResource(pluginDir);
    default:
      return {
        available: false,
        reason: `Runtime "${runtimeType}" declares no bundled engine resource`,
        code: 'SDK_ENGINE_UNAVAILABLE',
      };
  }
}

/**
 * Resolve the bundled engine resource for a runtime via the injected plugin
 * directory provider. Returns `undefined` when no provider is configured
 * (tests) — callers treat that as "check not performed" rather than available.
 */
export function resolveBundledRuntimeResource(
  runtimeType: string
): BundledRuntimeResourceResolution | undefined {
  const pluginDir = pluginDirProvider?.(runtimeType);
  if (!pluginDir) return undefined;
  return resolveBundledRuntimeResourceFromPluginDir(runtimeType, pluginDir);
}
