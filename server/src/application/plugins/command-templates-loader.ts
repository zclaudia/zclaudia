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
  } catch {
    return undefined;
  }
}

/**
 * Discover command templates across source-tagged paths via pi
 * `loadSourcedPromptTemplates`, then enrich each with frontmatter
 * `description:` override and (for plugin source) plugin provenance.
 */
export async function loadAllCommandTemplates(
  env: ExecutionEnv,
  inputs: CommandTemplateLoadInput[],
): Promise<CommandTemplateLoadResult> {
  const piInputs = inputs.map(({ path: p, source }) => ({ path: p, source }));
  const result = await loadSourcedPromptTemplates<CommandSource>(env, piInputs);

  const templates: SourcedPromptTemplate[] = result.promptTemplates.map(
    ({ promptTemplate, source }) => {
      // Reconstruct file path. Pi names templates by filename basename without
      // extension; we walk inputs of matching source and pick the first whose
      // input.path + name.md is the expected location. For plugin sources
      // (multiple inputs may share `source: 'plugin'`), this uses the first
      // matching plugin input — acceptable since each plugin's path is unique.
      const candidatePaths = inputs
        .filter((i) => i.source === source)
        .map((i) => path.join(i.path, `${promptTemplate.name}.md`));
      const filePath = candidatePaths[0] ?? '';
      const matchingInput = inputs
        .filter((i) => i.source === source)
        .find((i) => candidatePaths.includes(path.join(i.path, `${promptTemplate.name}.md`)));
      const fmDescription = extractFrontmatterDescription(filePath);
      return {
        template: fmDescription
          ? { ...promptTemplate, description: fmDescription }
          : promptTemplate,
        source,
        filePath,
        plugin: matchingInput?.plugin,
      };
    },
  );

  const diagnostics: CommandTemplateDiagnostic[] = result.diagnostics.map((d) => ({
    type: d.type,
    code: d.code,
    message: d.message,
    path: d.path,
    source: d.source,
  }));

  return { templates, diagnostics };
}
