import Database from 'better-sqlite3';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DesignService } from '../design-service.js';
import { TemplateService } from '../template-service.js';
import {
  DESIGN_TEMPLATES,
  getTemplateDefinition,
  type TemplateDefinition,
} from '../template-catalog.js';

// Partial mock: let the concurrency test interpose an external rewrite between
// TemplateService's overwrite hash-read and the guarded write. Only fires when
// `afterTemplateRead` is set; every other test runs the real code untouched.
let afterTemplateRead: ((filePath: string) => Promise<void>) | null = null;

vi.mock('../../../infra/fs/safe-file-write.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../infra/fs/safe-file-write.js')>();
  return {
    ...actual,
    readBoundedFile: async (...args: Parameters<typeof actual.readBoundedFile>) => {
      const result = await actual.readBoundedFile(...args);
      if (afterTemplateRead) await afterTemplateRead(args[0]);
      return result;
    },
  };
});

const MAX_TEMPLATE_FILE_BYTES = 12 * 1024;

function htmlOf(template: TemplateDefinition): string {
  return template.sources.find(source => source.path.endsWith('index.html'))?.content ?? '';
}

function cssOf(template: TemplateDefinition): string {
  return template.sources.find(source => source.path.endsWith('styles.css'))?.content ?? '';
}

describe('design template catalog invariants', () => {
  it('exposes the four built-in templates with complete metadata', () => {
    expect(DESIGN_TEMPLATES.map(template => template.id)).toEqual([
      'landing',
      'dashboard',
      'mobile',
      'showcase',
    ]);
    for (const template of DESIGN_TEMPLATES) {
      expect(template.name).toMatch(/[\u4e00-\u9fff]/);
      expect(template.description).toMatch(/[\u4e00-\u9fff]/);
      expect(template.version).toBe('1.0.0');
      expect(template.source).toBe('zclaudia-builtin');
      expect(template.entry).toBe(`design/${template.id}/index.html`);
      expect(template.files).toContain(template.entry);
      expect(new Set(template.files).size).toBe(template.files.length);
      for (const file of template.files) {
        expect(file.startsWith(`design/${template.id}/`)).toBe(true);
        expect(file.split('/').pop()).toMatch(/^(index\.html|styles\.css)$/);
      }
    }
  });

  for (const summary of DESIGN_TEMPLATES) {
    describe(`template ${summary.id}`, () => {
      const template = getTemplateDefinition(summary.id) as TemplateDefinition;
      const html = htmlOf(template);
      const css = cssOf(template);

      it('keeps every file within the 12 KiB catalog limit', () => {
        for (const source of template.sources) {
          expect(Buffer.byteLength(source.content, 'utf8')).toBeLessThanOrEqual(
            MAX_TEMPLATE_FILE_BYTES
          );
        }
      });

      it('has the required document skeleton (doctype, zh-CN, viewport, stylesheet link)', () => {
        expect(html.toLowerCase()).toMatch(/^<!doctype html>/);
        expect(html).toContain('<html lang="zh-CN">');
        expect(html).toMatch(/<meta[^>]+name="viewport"[^>]+>/i);
        expect(html).toContain('<link rel="stylesheet" href="styles.css">');
      });

      it('contains no scripts and no inline event handler attributes', () => {
        expect(html.toLowerCase()).not.toContain('<script');
        expect(html).not.toMatch(/\son[a-z]+\s*=/i);
      });

      it('keeps every href/src relative or an in-page anchor (no scheme, protocol-relative or absolute path)', () => {
        const references = [...html.matchAll(/\s(?:href|src)\s*=\s*"([^"]*)"/gi)].map(match => match[1]);
        expect(references.length).toBeGreaterThan(0);
        for (const reference of references) {
          expect(reference).not.toBe('');
          expect(reference).not.toMatch(/^[a-zA-Z][a-zA-Z0-9+.-]*:/);
          expect(reference.startsWith('//')).toBe(false);
          expect(reference.startsWith('/')).toBe(false);
          expect(reference).not.toMatch(/\\/);
        }
      });

      it('uses only inline SVG images and CSS gradients (no binary or external resources)', () => {
        expect(css).not.toMatch(/url\(/);
        expect(css).not.toMatch(/@import/i);
        expect(html).not.toMatch(/<img\b/i);
        if (/<svg\b/i.test(html)) {
          expect(html).toContain('</svg>');
        }
      });

      it('carries a :root palette, base typography and at least one media query in styles.css', () => {
        expect(css).toMatch(/:root\s*\{/);
        expect(css).toMatch(/--color-[a-z-]+\s*:/);
        expect(css).toMatch(/body\s*\{/);
        expect(css).toMatch(/font-family\s*:/);
        expect(css).toMatch(/@media[^{]+\{/);
      });

      it('uses Chinese sample copy with semantic regions', () => {
        expect(html).toMatch(/[\u4e00-\u9fff]/);
        for (const tag of ['<header', '<main', '<footer']) {
          expect(html).toContain(tag);
        }
        expect(html).toMatch(/<section[\s>]/);
      });

      it('matches its template-specific layout contract', () => {
        if (summary.id === 'landing') {
          expect(html).toMatch(/class="[^"]*hero/);
          expect(html).toMatch(/class="[^"]*feature-grid/);
          expect(html).toMatch(/class="[^"]*cta/);
        } else if (summary.id === 'dashboard') {
          expect(html).toContain('<aside class="sidebar">');
          expect(html).toMatch(/class="[^"]*stat-grid/);
          expect(css).toMatch(/grid-template-columns/);
        } else if (summary.id === 'mobile') {
          expect(css).toMatch(/max-width:\s*390px/);
          expect(css).toMatch(/grid-template-columns:\s*repeat\(4, 1fr\)/);
          expect(html).toMatch(/class="tab-bar"/);
        } else if (summary.id === 'showcase') {
          expect(html.match(/<figure/g)?.length).toBeGreaterThanOrEqual(4);
          expect(css).toMatch(/class="work-grid"|\.work-grid\s*\{/);
        }
      });
    });
  }

  it('derives metadata and sources from the same definitions', () => {
    for (const template of DESIGN_TEMPLATES) {
      const definition = getTemplateDefinition(template.id);
      expect(definition).toBeDefined();
      expect(definition?.sources.map(source => source.path)).toEqual(template.files);
    }
    expect(getTemplateDefinition('nope')).toBeUndefined();
  });
});

describe('TemplateService.install', () => {
  let db: Database.Database;
  let temp: string;
  let rootA: string;
  let service: DesignService;
  let templates: TemplateService;

  beforeEach(async () => {
    temp = await mkdtemp(path.join(os.tmpdir(), 'design-template-'));
    rootA = path.join(temp, 'a');
    await mkdir(rootA);
    db = new Database(':memory:');
    db.exec(`CREATE TABLE projects (id TEXT PRIMARY KEY, root_path TEXT);
      CREATE TABLE sessions (id TEXT PRIMARY KEY, project_id TEXT, working_directory TEXT);
      INSERT INTO projects VALUES ('pa', '${rootA}');
      INSERT INTO sessions VALUES ('sa', 'pa', NULL);`);
    service = new DesignService(db);
    templates = new TemplateService(service);
  });

  afterEach(async () => {
    afterTemplateRead = null;
    db.close();
    await rm(temp, { recursive: true, force: true });
  });

  it('list() returns the static catalog without touching the workspace', async () => {
    const listed = templates.list();
    expect(listed.templates).toHaveLength(4);
    expect(listed.templates.map(template => template.id)).toContain('landing');
  });

  it('installs every template file plus a correct TEMPLATE.json marker', async () => {
    const definition = getTemplateDefinition('landing') as TemplateDefinition;
    const result = await templates.install('sa', 'landing');
    expect(result.entry).toBe('design/landing/index.html');
    expect(result.installed).toEqual([
      'design/landing/index.html',
      'design/landing/styles.css',
      'design/landing/TEMPLATE.json',
    ]);
    for (const source of definition.sources) {
      await expect(readFile(path.join(rootA, ...source.path.split('/')), 'utf8')).resolves.toBe(
        source.content
      );
    }
    const marker = JSON.parse(
      await readFile(path.join(rootA, 'design', 'landing', 'TEMPLATE.json'), 'utf8')
    );
    expect(marker).toMatchObject({
      templateId: 'landing',
      version: '1.0.0',
      entry: 'design/landing/index.html',
    });
    expect(new Date(marker.installedAt).toISOString()).toBe(marker.installedAt);

    // The installed entry is a first-class design document afterwards.
    const document = await service.readDocument('sa', 'design/landing/index.html');
    expect(document.source).toBe(definition.sources[0].content);
  });

  it('refuses to follow a symlinked design directory out of the workspace', async () => {
    const outside = path.join(temp, 'outside');
    await mkdir(outside);
    await symlink(outside, path.join(rootA, 'design'));
    await expect(templates.install('sa', 'landing')).rejects.toMatchObject({
      status: 403,
      code: 'PATH_FORBIDDEN',
    });
    // Nothing landed outside the workspace through the symlink.
    await expect(readFile(path.join(outside, 'landing', 'index.html'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('rejects a repeat install with the full conflicting file list', async () => {    await templates.install('sa', 'showcase');
    const conflict = templates.install('sa', 'showcase');
    await expect(conflict).rejects.toMatchObject({
      status: 409,
      code: 'TEMPLATE_TARGET_EXISTS',
    });
    await expect(conflict).rejects.toMatchObject({
      details: {
        files: [
          'design/showcase/index.html',
          'design/showcase/styles.css',
          'design/showcase/TEMPLATE.json',
        ],
      },
    });
    // Nothing was clobbered by the rejected attempt.
    const definition = getTemplateDefinition('showcase') as TemplateDefinition;
    await expect(readFile(path.join(rootA, 'design', 'showcase', 'styles.css'), 'utf8')).resolves.toBe(
      definition.sources[1].content
    );
  });

  it('replaces an existing install when overwrite is explicitly confirmed', async () => {
    await templates.install('sa', 'landing');
    await writeFile(path.join(rootA, 'design', 'landing', 'index.html'), '<p>hand-edited</p>');
    const result = await templates.install('sa', 'landing', true);
    expect(result.installed).toHaveLength(3);
    const definition = getTemplateDefinition('landing') as TemplateDefinition;
    await expect(readFile(path.join(rootA, 'design', 'landing', 'index.html'), 'utf8')).resolves.toBe(
      definition.sources[0].content
    );
    const marker = JSON.parse(
      await readFile(path.join(rootA, 'design', 'landing', 'TEMPLATE.json'), 'utf8')
    );
    expect(marker.templateId).toBe('landing');
  });

  it('fails the overwrite with REVISION_CONFLICT when the file changed mid-install', async () => {
    await templates.install('sa', 'landing');
    afterTemplateRead = async filePath => {
      if (filePath.endsWith('index.html')) {
        await writeFile(path.join(rootA, 'design', 'landing', 'index.html'), '<p>raced</p>');
      }
    };
    await expect(templates.install('sa', 'landing', true)).rejects.toMatchObject({
      status: 409,
      code: 'REVISION_CONFLICT',
    });
    await expect(readFile(path.join(rootA, 'design', 'landing', 'index.html'), 'utf8')).resolves.toBe(
      '<p>raced</p>'
    );
  });

  it('validates template id, overwrite flag and session', async () => {
    await expect(templates.install('sa', 'unknown-template')).rejects.toMatchObject({
      status: 404,
      code: 'TEMPLATE_NOT_FOUND',
    });
    await expect(templates.install('sa', '')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(templates.install('sa', 'landing', 'yes')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    await expect(templates.install('absent', 'landing')).rejects.toMatchObject({
      code: 'SESSION_NOT_FOUND',
    });
  });
});
