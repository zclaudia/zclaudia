/**
 * Plugin-bundled skill bootstrap.
 *
 * Bridges the PluginLoader (which only collects plugin skill directories,
 * not skill content) with the shared skill cache in skill-tools. Must run
 * AFTER `loadAndCacheSkills` (workspace + external) so the dedup priority
 * holds: workspace > external > plugin.
 *
 * Lives in its own module (instead of inside loader.ts) so skill-tools.ts
 * does not need to import the heavy plugin runtime; the only contract is
 * the `PluginSkillDirProvider` interface below.
 */

import { loadAllSkills, type SkillSource } from './skill-loader.js';
import { addPluginSkills, addSkillLoadDiagnostics, type PluginSkillReloader } from './skill-tools.js';
import type { ExecutionEnv } from '../../infra/execution-env.js';

/** Minimal contract the bootstrap needs from PluginLoader. */
export interface PluginSkillDirProvider {
  getPluginSkillDirs(): Array<{ path: string; source: SkillSource }>;
}

/**
 * Load plugin-bundled skills and merge them into the shared cache. Must run
 * AFTER `loadAndCacheSkills` (workspace + external) so dedup behaves
 * predictably (workspace/external win on id collision).
 *
 * Returns the count loaded from pi (before dedup). 0 when the loader has
 * not collected any plugin skill dirs.
 */
export async function loadAndCachePluginSkills(
  env: ExecutionEnv,
  loader: PluginSkillDirProvider,
): Promise<number> {
  const inputs = loader.getPluginSkillDirs();
  if (inputs.length === 0) return 0;
  const result = await loadAllSkills(env, inputs);
  addPluginSkills(result.skills);
  addSkillLoadDiagnostics(result.diagnostics);
  for (const d of result.diagnostics) {
    console.warn(`[PluginSkills] ${d.code}: ${d.message} — ${d.path}`);
  }
  if (result.skills.length > 0) {
    console.log(`[PluginSkills] loaded ${result.skills.length} plugin skill(s)`);
  }
  return result.skills.length;
}

/**
 * Wrap a PluginLoader as a PluginSkillReloader for `refreshSkillCache`.
 * Breaks the circular import between skill-tools and skill-bootstrap.
 */
export function pluginSkillReloader(loader: PluginSkillDirProvider): PluginSkillReloader {
  return {
    reload: (env) => loadAndCachePluginSkills(env, loader),
  };
}
