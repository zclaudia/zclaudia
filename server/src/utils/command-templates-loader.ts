import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import matter from 'gray-matter';
import { loadSourcedPromptTemplates, type PromptTemplate } from '@earendil-works/pi-agent-core';
import type { ExecutionEnv } from '../../infra/execution-env.js';

/** Where a discovered command template came from. App-defined; pi treats it opaquely. */
export type CommandSource = 'user' | 'project' | 'plugin';

/** Plugin-specific provenance (basename of the plugin owning this command). */
export interface PluginProvenance {
  pluginName: string;
}

/** Prompt template with provenance + (for plugin source) extra metadata. */
export interface SourcedPromptTemplate {
  template: PromptTemplate;
  source: CommandSource;
  /** Absolute path to the .md file (derived from input dir + template.name + '.md'). */
  filePath: string;
  /** Present when source === 'plugin'. */
  plugin?: PluginProvenance;
}

export interface CommandTemplateDiagnostic {
  type: 'warning';
  code: string;
  message: string;
  path: string;
  source: CommandSource;
}

export interface CommandTemplateLoadInput {
  /** Directory containing .md command files (pi loads direct children non-recursively). */
  path: string;
  source: CommandSource;
  /** Required when source === 'plugin'. */
  plugin?: PluginProvenance;
}

export interface CommandTemplateLoadResult {
  templates: SourcedPromptTemplate[];
  diagnostics: CommandTemplateDiagnostic[];
}

function extractFrontmatterDescription(filePath: string): string | undefined {
  try {
    const raw = readFileSync(filePath, 'utf-8');
    const parsed = matter(raw);
    const data = (parsed.data ?? {}) as Record<string, unknown>;
    if (typeof data.description === 'string' && data.description.trim().length > 0) {
      return data.description.trim();
    }
    return undefined;
  } catch (err) {
    // Malformed frontmatter (bad YAML, file unreadable). Template still loads
    // with pi-derived description; warn so the operator can fix it.
    console.warn(`[command-templates-loader] Failed to parse frontmatter for ${filePath}:`, err);
    return undefined;
  }
}

/**
 * Discover command templates across source-tagged paths via pi
 * `loadSourcedPromptTemplates`, then enrich each with frontmatter
 * `description:` override and (for plugin source) plugin provenance.
 *
 * Calls pi once per input so each result is unambiguously attributable to
 * its source dir. This avoids the multi-plugin attribution bug where all
 * results sharing source='plugin' would be attributed to the first plugin.
 */
export async function loadAllCommandTemplates(
  env: ExecutionEnv,
  inputs: CommandTemplateLoadInput[]
): Promise<CommandTemplateLoadResult> {
  const templates: SourcedPromptTemplate[] = [];
  const diagnostics: CommandTemplateDiagnostic[] = [];

  // Call pi once per input so each result is unambiguously attributable.
  // loadSourcedPromptTemplates handles missing dirs (returns empty + no
  // diagnostics for them).
  for (const input of inputs) {
    const result = await loadSourcedPromptTemplates<CommandSource>(env, [
      { path: input.path, source: input.source },
    ]);

    for (const { promptTemplate, source } of result.promptTemplates) {
      const filePath = path.join(input.path, `${promptTemplate.name}.md`);
      const fmDescription = extractFrontmatterDescription(filePath);
      templates.push({
        template: fmDescription
          ? { ...promptTemplate, description: fmDescription }
          : promptTemplate,
        source,
        filePath,
        plugin: input.plugin,
      });
    }

    for (const d of result.diagnostics) {
      diagnostics.push({
        type: d.type,
        code: d.code,
        message: d.message,
        path: d.path,
        source: d.source,
      });
    }
  }

  return { templates, diagnostics };
}
