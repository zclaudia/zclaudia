import * as path from 'path';
import * as os from 'os';
import type { SlashCommand } from '@zclaudia/shared/features/commands';
import { type ExecutionEnv } from '../infra/execution-env.js';
import {
  loadAllCommandTemplates,
  type CommandTemplateLoadInput,
  type SourcedPromptTemplate,
} from '../application/plugins/command-templates-loader.js';

/**
 * Scans for slash command templates across three sources:
 *
 *   user:    ~/.claude/commands/*.md
 *   project: <projectRoot>/.claude/commands/*.md
 *   plugin:  <pluginInstallPath>/commands/*.md and <pluginInstallPath>/*.md
 *
 * Templates are loaded via pi `loadSourcedPromptTemplates`. Naming rules:
 *
 *   - Single source for a basename → only bare `/<basename>` is published
 *   - Multiple sources for a basename → publishes prefixed forms
 *     (`/user:<base>`, `/project:<base>`, `/<plugin>:<base>`) PLUS bare
 *     `/<base>` resolving to project > user > plugin
 *   - Plugin templates ALWAYS additionally publish `/<plugin>:<base>`
 *     (preserves existing autocomplete UX)
 */

interface ScanOptions {
  projectRoot?: string;
  includePlugins?: boolean;
}

interface InstalledPluginsFile {
  version: number;
  plugins: Record<string, PluginInstallation[]>;
}

interface PluginInstallation {
  scope: 'user' | 'project';
  installPath: string;
  version: string;
  installedAt: string;
  lastUpdated: string;
}

interface PluginManifest {
  name: string;
  description: string;
  author?: { name: string; email?: string };
}

const EXCLUDED_PLUGIN_FILES = new Set([
  'readme.md',
  'contributing.md',
  'code_of_conduct.md',
  'changelog.md',
  'license.md',
  'security.md',
]);

/**
 * Read installed_plugins.json + each plugin's installPath. Returns the loader
 * inputs (each pointing at a candidate commands dir). Does NOT read command
 * content — that's delegated to command-templates-loader / pi.
 */
async function discoverPluginCommandInputs(env: ExecutionEnv): Promise<CommandTemplateLoadInput[]> {
  const inputs: CommandTemplateLoadInput[] = [];
  const pluginsFile = path.join(os.homedir(), '.claude', 'plugins', 'installed_plugins.json');

  const exists = await env.exists(pluginsFile);
  if (!exists.ok || !exists.value) return inputs;

  const read = await env.readTextFile(pluginsFile);
  if (!read.ok) {
    console.error('[command-scanner] reading installed_plugins.json failed:', read.error);
    return inputs;
  }

  let parsed: InstalledPluginsFile;
  try {
    parsed = JSON.parse(read.value);
  } catch (err) {
    console.error('[command-scanner] parsing installed_plugins.json failed:', err);
    return inputs;
  }

  for (const [pluginKey, installations] of Object.entries(parsed.plugins)) {
    const pluginName = pluginKey.split('@')[0];
    const install = installations[0];
    if (!install?.installPath) continue;

    const installExists = await env.exists(install.installPath);
    if (!installExists.ok || !installExists.value) continue;

    // Two candidate locations per plugin (pi skips missing dirs).
    for (const sub of ['commands', '.']) {
      const dir = sub === '.' ? install.installPath : path.join(install.installPath, sub);
      inputs.push({ path: dir, source: 'plugin', plugin: { pluginName } });
    }
  }
  return inputs;
}

/** Read a plugin's author name (for display suffix), or fall back to bare. */
async function readPluginAuthor(
  env: ExecutionEnv,
  installPath: string,
  pluginName: string
): Promise<string> {
  const manifestPath = path.join(installPath, '.claude-plugin', 'plugin.json');
  const exists = await env.exists(manifestPath);
  if (!exists.ok || !exists.value) return ` (plugin:${pluginName})`;
  const read = await env.readTextFile(manifestPath);
  if (!read.ok) return ` (plugin:${pluginName})`;
  try {
    const m: PluginManifest = JSON.parse(read.value);
    return ` (plugin:${pluginName}@${m.author?.name ?? 'unknown'})`;
  } catch {
    return ` (plugin:${pluginName})`;
  }
}

/**
 * Group templates by basename and emit SlashCommand[] entries per the naming
 * rules at the top of this file.
 */
function classifyTemplates(
  templates: SourcedPromptTemplate[],
  pluginDescriptionByName: Map<string, string>
): SlashCommand[] {
  const byBase = new Map<string, SourcedPromptTemplate[]>();
  for (const t of templates) {
    const base = path.basename(t.filePath, '.md');
    const arr = byBase.get(base) ?? [];
    arr.push(t);
    byBase.set(base, arr);
  }

  const result: SlashCommand[] = [];

  for (const [base, group] of byBase) {
    const hasCollision = group.length > 1;

    // Prefixed forms: emit for plugins always; for user/project only on collision.
    // Dedup by command name within the group — a single plugin can have the
    // same basename in both <install>/commands and <install>/ (we add both as
    // candidate inputs), which would otherwise emit the prefixed form twice.
    const prefixedEmitted = new Set<string>();
    for (const t of group) {
      const isPlugin = t.source === 'plugin';
      const shouldEmitPrefixed = hasCollision || isPlugin;
      if (!shouldEmitPrefixed) continue;

      const description = t.template.description ?? 'Custom command';
      const pluginSuffix =
        isPlugin && t.plugin
          ? (pluginDescriptionByName.get(t.plugin.pluginName) ?? ` (plugin:${t.plugin.pluginName})`)
          : '';
      const prefixedName =
        isPlugin && t.plugin ? `/${t.plugin.pluginName}:${base}` : `/${t.source}:${base}`;

      if (prefixedEmitted.has(prefixedName)) continue;
      prefixedEmitted.add(prefixedName);

      result.push({
        command: prefixedName,
        description: description + (isPlugin ? pluginSuffix : ''),
        source: isPlugin ? 'plugin' : 'custom',
        scope: t.source === 'project' ? 'project' : 'global',
        filePath: t.filePath,
      });
    }

    // Bare name: priority project > user > plugin.
    const winner =
      group.find(t => t.source === 'project') ??
      group.find(t => t.source === 'user') ??
      group.find(t => t.source === 'plugin');
    if (winner) {
      const description = winner.template.description ?? 'Custom command';
      const isPlugin = winner.source === 'plugin';
      const pluginSuffix =
        isPlugin && winner.plugin
          ? (pluginDescriptionByName.get(winner.plugin.pluginName) ??
            ` (plugin:${winner.plugin.pluginName})`)
          : '';
      result.push({
        command: `/${base}`,
        description: description + (isPlugin ? pluginSuffix : ''),
        source: isPlugin ? 'plugin' : 'custom',
        scope: winner.source === 'project' ? 'project' : 'global',
        filePath: winner.filePath,
      });
    }
  }

  return result;
}

export async function scanCustomCommands(
  env: ExecutionEnv,
  options: ScanOptions = {}
): Promise<SlashCommand[]> {
  const includePlugins = options.includePlugins !== false;

  const inputs: CommandTemplateLoadInput[] = [];

  // user (global) source — always
  inputs.push({ path: path.join(os.homedir(), '.claude', 'commands'), source: 'user' });

  // project source — when projectRoot provided
  if (options.projectRoot) {
    inputs.push({ path: path.join(options.projectRoot, '.claude', 'commands'), source: 'project' });
  }

  // plugin sources
  const pluginDescriptionByName = new Map<string, string>();
  if (includePlugins) {
    const pluginInputs = await discoverPluginCommandInputs(env);
    inputs.push(...pluginInputs);

    const uniquePlugins = new Map<string, string>(); // pluginName → installPath
    for (const inp of pluginInputs) {
      if (inp.plugin && !uniquePlugins.has(inp.plugin.pluginName)) {
        // Recover installPath: strip `/commands` suffix if present
        const commandsSuffix = path.sep + 'commands';
        const installPath = inp.path.endsWith(commandsSuffix)
          ? inp.path.slice(0, -commandsSuffix.length)
          : inp.path;
        uniquePlugins.set(inp.plugin.pluginName, installPath);
      }
    }
    for (const [pluginName, installPath] of uniquePlugins) {
      pluginDescriptionByName.set(pluginName, await readPluginAuthor(env, installPath, pluginName));
    }
  }

  const { templates, diagnostics } = await loadAllCommandTemplates(env, inputs);

  for (const d of diagnostics) {
    console.warn(`[command-scanner] ${d.code} (${d.source}): ${d.message} — ${d.path}`);
  }

  // Drop excluded plugin doc files (README.md etc) — pi loads them as
  // templates, but we don't want them showing as commands.
  const filtered = templates.filter(t => {
    if (t.source !== 'plugin') return true;
    const base = path.basename(t.filePath).toLowerCase();
    return !EXCLUDED_PLUGIN_FILES.has(base);
  });

  return classifyTemplates(filtered, pluginDescriptionByName);
}

export function getGlobalCommandsDir(): string {
  return path.join(os.homedir(), '.claude', 'commands');
}

export function getProjectCommandsDir(projectRoot: string): string {
  return path.join(projectRoot, '.claude', 'commands');
}
