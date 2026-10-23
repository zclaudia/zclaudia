import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  SafeFileWriteError,
  readBoundedFile,
  safeWriteFile,
} from '../../infra/fs/safe-file-write.js';
import {
  DesignError,
  DesignService,
  assertContained,
  toDesignError,
  validateRelativePath,
} from './design-service.js';
import {
  DESIGN_TEMPLATES,
  getTemplateDefinition,
  type DesignTemplateSummary,
} from './template-catalog.js';

/** Single installed file cap (§2.2 step 5, FILE_TOO_LARGE beyond). */
export const MAX_TEMPLATE_FILE_BYTES = 64 * 1024;

interface InstallTarget {
  /** Workspace-relative path with '/' separators (as returned to clients). */
  relative: string;
  absolute: string;
}

/**
 * Install the built-in design templates into a session workspace (P4.1 §2.2).
 * Targets = template files + a generated TEMPLATE.json marker; existing files
 * never go away silently — a repeat install conflicts until `overwrite` is
 * explicitly requested, and even then the replace goes through the regular
 * revision-verified write path.
 */
export class TemplateService {
  constructor(private readonly design: DesignService) {}

  /** Static catalog, no IO. */
  list(): { templates: DesignTemplateSummary[] } {
    return { templates: DESIGN_TEMPLATES.map(summary => ({ ...summary, files: [...summary.files] })) };
  }

  async install(
    sessionId: unknown,
    templateId: unknown,
    overwrite?: unknown
  ): Promise<{ installed: string[]; entry: string }> {
    if (typeof templateId !== 'string' || !templateId)
      throw new DesignError(400, 'VALIDATION_ERROR', 'templateId is required');
    const template = getTemplateDefinition(templateId);
    if (!template) throw new DesignError(404, 'TEMPLATE_NOT_FOUND', 'Template was not found');
    if (overwrite !== undefined && typeof overwrite !== 'boolean')
      throw new DesignError(400, 'VALIDATION_ERROR', 'overwrite must be a boolean');
    const root = await this.design.workspace(sessionId);

    // Catalog paths are static constants; validateRelativePath/assertContained
    // keep the same workspace-containment skeleton as user-supplied paths
    // (non-dot components, no absolute or escaping targets).
    const targets: InstallTarget[] = template.sources.map(source => ({
      relative: source.path,
      absolute: path.resolve(root, validateRelativePath(source.path)),
    }));
    const markerRelative = `design/${template.id}/TEMPLATE.json`;
    const markerContent = Buffer.from(
      `${JSON.stringify(
        {
          templateId: template.id,
          version: template.version,
          installedAt: new Date().toISOString(),
          entry: template.entry,
        },
        null,
        2
      )}\n`,
      'utf8'
    );
    targets.push({
      relative: markerRelative,
      absolute: path.resolve(root, validateRelativePath(markerRelative)),
    });
    for (const target of targets) assertContained(root, target.absolute);
    for (const target of targets) {
      const parent = path.dirname(target.absolute);
      await fs.mkdir(parent, { recursive: true });
      // A symlinked parent (e.g. `design` → outside the workspace) must not
      // carry the install out of the workspace; the leaf itself is guarded by
      // safeWriteFile's no-follow checks.
      assertContained(root, await fs.realpath(parent));
    }

    // Existing targets block the install unless overwrite was confirmed.
    if (overwrite !== true) {
      const conflicts: string[] = [];
      for (const target of targets) {
        try {
          await fs.lstat(target.absolute);
          conflicts.push(target.relative);
        } catch {
          /* missing → writable */
        }
      }
      if (conflicts.length > 0)
        throw new DesignError(409, 'TEMPLATE_TARGET_EXISTS', 'Template files already exist', {
          files: conflicts,
        });
    }

    const installed: string[] = [];
    for (const target of targets) {
      const bytes =
        target.relative === markerRelative
          ? markerContent
          : Buffer.from(
              template.sources.find(source => source.path === target.relative)?.content ?? '',
              'utf8'
            );
      let expectedRevision = '';
      if (overwrite === true) {
        // Replace only what was seen: hash the current content and let
        // safeWriteFile reject the write when it raced ahead of us.
        try {
          const current = await readBoundedFile(target.absolute, MAX_TEMPLATE_FILE_BYTES, 'Template file');
          expectedRevision = createHash('sha256').update(current.bytes).digest('hex');
        } catch (error) {
          if (!(error instanceof SafeFileWriteError && error.code === 'FILE_NOT_FOUND'))
            throw toDesignError(error);
        }
      }
      try {
        await safeWriteFile(target.absolute, bytes, {
          expectedRevision,
          createIfMissing: true,
          maxBytes: MAX_TEMPLATE_FILE_BYTES,
        });
      } catch (error) {
        throw toDesignError(error);
      }
      installed.push(target.relative);
    }
    return { installed, entry: template.entry };
  }
}
