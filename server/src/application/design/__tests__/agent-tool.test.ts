import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { registerDesignWorkbenchTool } from '../agent-tool.js';
import { DesignAgentBridge } from '../agent-bridge.js';
import { toolRegistry } from '../../plugins/tool-registry.js';
import { createZClaudiaToolCatalog } from '../../plugins/tool-catalog.js';

describe('session Design tool via the shared tool catalog', () => {
  let db: Database.Database;
  let root: string;
  let bridge: DesignAgentBridge;
  const html = '<h1>Settings</h1>';
  const call = async (args: Record<string, unknown>, sessionId = 's') =>
    JSON.parse(
      await createZClaudiaToolCatalog().callTool('design_workbench', args, {
        sessionId,
        signal: new AbortController().signal,
      })
    );
  beforeEach(async () => {
    root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'design-agent-')));
    await mkdir(path.join(root, 'design'));
    await writeFile(path.join(root, 'design/settings.html'), html);
    await writeFile(path.join(root, 'design/DESIGN.md'), '# Brand rules');
    db = new Database(':memory:');
    db.exec(
      'CREATE TABLE projects (id TEXT PRIMARY KEY, root_path TEXT); CREATE TABLE sessions (id TEXT PRIMARY KEY, project_id TEXT, working_directory TEXT);'
    );
    db.prepare('INSERT INTO projects VALUES (?, ?)').run('p', root);
    db.prepare('INSERT INTO sessions VALUES (?, ?, NULL)').run('s', 'p');
    bridge = new DesignAgentBridge();
    registerDesignWorkbenchTool(db, bridge);
  });
  afterEach(async () => {
    toolRegistry.unregister('design_workbench');
    db.close();
    await rm(root, { recursive: true, force: true });
  });

  it('is discoverable in a regular session with the new-mockup workflow', () => {
    const tool = createZClaudiaToolCatalog()
      .listTools({ sessionId: 's' })
      .find(tool => tool.name === 'design_workbench');
    expect(tool?.description).toContain('NEW mockup');
    expect(tool?.description).toContain('displayed=true');
    expect(
      createZClaudiaToolCatalog()
        .listTools({})
        .some(tool => tool.name === 'design_workbench')
    ).toBe(false);
  });

  it('returns disk and brand context with explicit unavailable UI', async () => {
    const result = await call({ action: 'get_context', sessionId: 'other' });
    expect(result).toMatchObject({
      ok: true,
      workspace: root,
      files: ['design/settings.html'],
      brand: { designMd: '# Brand rules' },
      ui: { ok: false, code: 'UI_UNAVAILABLE' },
    });
  });

  it('pins a validated document revision and returns the UI acknowledgement', async () => {
    const request = vi
      .spyOn(bridge, 'request')
      .mockResolvedValue({ ok: false, code: 'UNSAVED_CHANGES', message: 'Save first' });
    await expect(call({ action: 'present', path: 'design/settings.html' })).resolves.toMatchObject({
      ok: false,
      code: 'UNSAVED_CHANGES',
    });
    expect(request).toHaveBeenCalledWith('s', {
      action: 'present',
      path: 'design/settings.html',
      expectedRevision: createHash('sha256').update(html).digest('hex'),
    });
  });

  it('rejects traversal, missing files, non-HTML files, and unknown sessions before presenting', async () => {
    const request = vi.spyOn(bridge, 'request');
    for (const file of [
      '../outside.html',
      '/outside.html',
      'design/missing.html',
      'design/DESIGN.md',
    ]) {
      expect((await call({ action: 'present', path: file })).ok).toBe(false);
    }
    expect((await call({ action: 'present', path: 'design/settings.html' }, 'missing')).code).toBe(
      'SESSION_NOT_FOUND'
    );
    expect(request).not.toHaveBeenCalled();
  });
});
