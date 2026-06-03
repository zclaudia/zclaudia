import { execFileSync } from 'node:child_process';

/**
 * Environment requirements declared by a skill's frontmatter `requires:` block.
 * Pi loads the frontmatter for us (via gray-matter) but does NOT enforce these
 * fields — enforcement is the application's job (this module).
 */
export interface SkillRequirements {
  os?: string[];
  binaries?: string[];
  env?: string[];
}

export interface RequirementContext {
  /** Override for process.platform. Defaults to the real platform. */
  os?: string;
}

const binaryCache = new Map<string, boolean>();

function isBinaryAvailable(name: string): boolean {
  const hit = binaryCache.get(name);
  if (hit !== undefined) return hit;
  try {
    execFileSync('which', [name], { stdio: 'ignore' });
    binaryCache.set(name, true);
    return true;
  } catch {
    binaryCache.set(name, false);
    return false;
  }
}

const OS_ALIASES: Record<string, string> = {
  macos: 'darwin', mac: 'darwin', windows: 'win32',
  linux: 'linux', darwin: 'darwin', win32: 'win32',
};

/**
 * True when the runtime environment satisfies all of the skill's requirements.
 * Skills with no `requires` block always pass.
 */
export function meetsRequirements(
  requirements: SkillRequirements | undefined,
  ctx: RequirementContext = {},
): boolean {
  if (!requirements) return true;

  if (requirements.os && requirements.os.length > 0) {
    const current = ctx.os ?? process.platform;
    const required = requirements.os.map((os) => OS_ALIASES[os.toLowerCase()] ?? os.toLowerCase());
    if (!required.includes(current)) return false;
  }
  if (requirements.binaries) {
    for (const bin of requirements.binaries) {
      if (!isBinaryAvailable(bin)) return false;
    }
  }
  if (requirements.env) {
    for (const v of requirements.env) {
      if (!process.env[v]) return false;
    }
  }
  return true;
}

/** Test-only: clear the binary availability cache between tests. */
export function __resetBinaryCache(): void {
  binaryCache.clear();
}
