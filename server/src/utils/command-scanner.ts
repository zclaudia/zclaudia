import * as path from 'path';
import * as os from 'os';
import type { SlashCommand } from '@zclaudia/shared/features/commands';
import { type ExecutionEnv } from '../infra/execution-env.js';

/**
 * Scans for custom slash commands in .claude/commands directories
 * and plugin commands from installed plugin directories
 *
 * Custom commands are stored as markdown files:
 * - Global: ~/.claude/commands/*.md
 * - Project: <projectRoot>/.claude/commands/*.md
 *
 * Plugin commands are stored in:
 * - ~/.claude/plugins/installed_plugins.json (plugin registry)
 * - Each plugin's installPath/commands/*.md or installPath/*.md
 *
 * The command name is derived from the filename:
 * - Global: review.md -> /review
 * - Project: fix-issue.md -> /fix-issue
 * - Plugin: code-review.md from plugin "code-review" -> /code-review:code-review
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
  author?: {
    name: string;
    email?: string;
  };
}

function extractDescription(content: string): string {
  if (content.startsWith('---')) {
    const endIndex = content.indexOf('---', 3);
    if (endIndex !== -1) {
      const frontmatter = content.substring(3, endIndex);
      const descMatch = frontmatter.match(/^description:\s*(.+)$/m);
      if (descMatch) {
        const desc = descMatch[1].trim();
        return desc.length > 80 ? desc.substring(0, 77) + '...' : desc;
      }
    }
  }

  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith('#')) {
      return trimmed.replace(/^#+\s*/, '').trim();
    }

    if (!trimmed.startsWith('---')) {
      return trimmed.length > 80 ? trimmed.substring(0, 77) + '...' : trimmed;
    }
  }

  return 'Custom command';
}

async function scanDirectory(
  env: ExecutionEnv,
  dir: string,
  scope: 'global' | 'project',
): Promise<SlashCommand[]> {
  const commands: SlashCommand[] = [];

  const dirExists = await env.exists(dir);
  if (!dirExists.ok || !dirExists.value) {
    return commands;
  }

  const listResult = await env.listDir(dir);
  if (!listResult.ok) {
    console.error(`Error scanning directory ${dir}:`, listResult.error);
    return commands;
  }

  for (const entry of listResult.value) {
    if (!entry.name.endsWith('.md')) continue;

    const filePath = path.join(dir, entry.name);
    const info = await env.fileInfo(filePath);
    if (!info.ok || info.value.kind !== 'file') continue;

    const baseName = path.basename(entry.name, '.md');
    const commandName = `/${baseName}`;

    let description = 'Custom command';
    const read = await env.readTextFile(filePath);
    if (read.ok) {
      description = extractDescription(read.value);
    }

    commands.push({
      command: commandName,
      description,
      source: 'custom',
      scope,
      filePath,
    });
  }

  return commands;
}

async function scanPluginCommands(env: ExecutionEnv): Promise<SlashCommand[]> {
  const commands: SlashCommand[] = [];
  const pluginsFile = path.join(os.homedir(), '.claude', 'plugins', 'installed_plugins.json');

  const pluginsFileExists = await env.exists(pluginsFile);
  if (!pluginsFileExists.ok || !pluginsFileExists.value) {
    return commands;
  }

  const pluginsRead = await env.readTextFile(pluginsFile);
  if (!pluginsRead.ok) {
    console.error('Error reading installed plugins:', pluginsRead.error);
    return commands;
  }

  let pluginsData: InstalledPluginsFile;
  try {
    pluginsData = JSON.parse(pluginsRead.value);
  } catch (error) {
    console.error('Error parsing installed plugins:', error);
    return commands;
  }

  for (const [pluginKey, installations] of Object.entries(pluginsData.plugins)) {
    const pluginName = pluginKey.split('@')[0];
    const installation = installations[0];
    if (!installation?.installPath) continue;

    const installPath = installation.installPath;
    const installExists = await env.exists(installPath);
    if (!installExists.ok || !installExists.value) continue;

    const commandsDir = path.join(installPath, 'commands');
    const commandsDirExists = await env.exists(commandsDir);

    const locations: Array<{ dir: string; exists: boolean }> = [
      { dir: commandsDir, exists: commandsDirExists.ok && commandsDirExists.value },
      { dir: installPath, exists: true },
    ];

    for (const { dir, exists } of locations) {
      if (!exists) continue;

      const listResult = await env.listDir(dir);
      if (!listResult.ok) {
        console.error(`Error scanning plugin directory ${dir}:`, listResult.error);
        continue;
      }

      for (const entry of listResult.value) {
        const lowerFile = entry.name.toLowerCase();
        const excludedFiles = [
          'readme.md',
          'contributing.md',
          'code_of_conduct.md',
          'changelog.md',
          'license.md',
          'security.md',
        ];
        if (!entry.name.endsWith('.md') || excludedFiles.includes(lowerFile)) continue;

        const filePath = path.join(dir, entry.name);
        const info = await env.fileInfo(filePath);
        if (!info.ok || info.value.kind !== 'file') continue;

        const baseName = path.basename(entry.name, '.md');
        const commandName = `/${pluginName}:${baseName}`;

        let description = 'Plugin command';
        const read = await env.readTextFile(filePath);
        if (read.ok) {
          description = extractDescription(read.value);
        }

        let pluginDescription = '';
        const manifestPath = path.join(installPath, '.claude-plugin', 'plugin.json');
        const manifestExists = await env.exists(manifestPath);
        if (manifestExists.ok && manifestExists.value) {
          const manifestRead = await env.readTextFile(manifestPath);
          if (manifestRead.ok) {
            try {
              const manifest: PluginManifest = JSON.parse(manifestRead.value);
              pluginDescription = ` (plugin:${pluginName}@${manifest.author?.name || 'unknown'})`;
            } catch {
              pluginDescription = ` (plugin:${pluginName})`;
            }
          } else {
            pluginDescription = ` (plugin:${pluginName})`;
          }
        } else {
          pluginDescription = ` (plugin:${pluginName})`;
        }

        commands.push({
          command: commandName,
          description: description + pluginDescription,
          source: 'plugin',
          scope: 'global',
          filePath,
        });
      }
    }
  }

  return commands;
}

export async function scanCustomCommands(
  env: ExecutionEnv,
  options: ScanOptions = {},
): Promise<SlashCommand[]> {
  const commands: SlashCommand[] = [];
  const includePlugins = options.includePlugins !== false;

  const globalDir = path.join(os.homedir(), '.claude', 'commands');
  const globalCommands = await scanDirectory(env, globalDir, 'global');

  if (options.projectRoot) {
    const projectDir = path.join(options.projectRoot, '.claude', 'commands');
    const projectCommands = await scanDirectory(env, projectDir, 'project');
    const projectNames = new Set(projectCommands.map((c) => c.command));
    commands.push(...projectCommands);
    commands.push(...globalCommands.filter((c) => !projectNames.has(c.command)));
  } else {
    commands.push(...globalCommands);
  }

  if (includePlugins) {
    commands.push(...(await scanPluginCommands(env)));
  }

  return commands;
}

export function getGlobalCommandsDir(): string {
  return path.join(os.homedir(), '.claude', 'commands');
}

export function getProjectCommandsDir(projectRoot: string): string {
  return path.join(projectRoot, '.claude', 'commands');
}
