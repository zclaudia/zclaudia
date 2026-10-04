import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { pathToFileURL } from 'url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LanguageServerError } from '../../providers/language-server-port.js';
import { LanguageServerManager, type LanguageServerManagerOptions } from '../manager.js';
import {
  attachPreviews,
  definitionLocations,
  hoverText,
  pruneSymbols,
  symbolList,
  toLocation,
} from '../query.js';
import type { LanguageServerPreset } from '../types.js';
import { createFakeServer, type FakeServer, type FakeServerOptions } from './fake-lsp-server.js';

const range = (line: number, character = 0) => ({
  start: { line, character },
  end: { line, character: character + 1 },
});

describe('query mapping', () => {
  const root = '/work/proj';

  it('maps workspace files to relative paths and flags external ones', () => {
    expect(toLocation(root, pathToFileURL('/work/proj/src/a.ts').href, range(4, 2))).toEqual({
      file: 'src/a.ts',
      line: 5,
      character: 3,
      endLine: 5,
      endCharacter: 4,
    });
    expect(toLocation(root, pathToFileURL('/usr/lib/node/x.d.ts').href, range(0))).toMatchObject({
      file: '/usr/lib/node/x.d.ts',
      external: true,
    });
  });

  it('accepts Location, Location[] and LocationLink[] for definition', () => {
    const uri = pathToFileURL('/work/proj/a.ts').href;
    expect(definitionLocations(root, null)).toEqual([]);
    expect(definitionLocations(root, { uri, range: range(1) })).toHaveLength(1);
    const [link] = definitionLocations(root, [
      { targetUri: uri, targetRange: range(1), targetSelectionRange: range(3, 6) },
    ]);
    expect(link).toMatchObject({ file: 'a.ts', line: 4, character: 7 });
  });

  it('renders every hover content shape as markdown', () => {
    expect(hoverText(null)).toBeNull();
    expect(hoverText({ contents: 'plain' })).toBe('plain');
    expect(hoverText({ contents: { kind: 'markdown', value: '**b**' } })).toBe('**b**');
    expect(hoverText({ contents: [{ language: 'ts', value: 'const a: 1' }, 'doc'] })).toBe(
      '```ts\nconst a: 1\n```\n\ndoc'
    );
  });

  it('maps DocumentSymbol trees and SymbolInformation lists', () => {
    const uri = pathToFileURL('/work/proj/a.ts').href;
    const tree = symbolList(root, uri, [
      {
        name: 'C',
        kind: 5,
        range: range(0),
        selectionRange: range(0),
        children: [{ name: 'm', kind: 6, range: range(1), selectionRange: range(1) }],
      },
    ]);
    expect(tree[0]).toMatchObject({ name: 'C', kind: 'class', children: [{ kind: 'method' }] });
    const flat = symbolList(root, null, [
      { name: 'f', kind: 12, location: { uri, range: range(2) }, containerName: 'mod' },
    ]);
    expect(flat[0]).toMatchObject({ name: 'f', kind: 'function', containerName: 'mod' });
  });

  it('prunes symbol trees depth first within the budget', () => {
    const leaf = (name: string) => ({
      name,
      kind: 'x',
      location: { file: 'a', line: 1, character: 1 },
    });
    const { symbols, truncated } = pruneSymbols(
      [{ ...leaf('a'), children: [leaf('a1'), leaf('a2')] }, leaf('b')],
      2
    );
    expect(truncated).toBe(true);
    expect(symbols).toEqual([{ ...leaf('a'), children: [leaf('a1')] }]);
  });

  it('attaches trimmed source lines as previews', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'lsp-preview-'));
    try {
      writeFileSync(path.join(dir, 'a.ts'), 'first\n    second line  \n');
      const locations = [
        { file: 'a.ts', line: 2, character: 1 },
        { file: 'missing.ts', line: 1, character: 1 },
      ];
      await attachPreviews(dir, locations);
      expect(locations[0]).toMatchObject({ preview: 'second line' });
      expect(locations[1]).not.toHaveProperty('preview');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('LanguageServerManager.query', () => {
  let dir: string;
  let servers: FakeServer[];
  let serverOptions: FakeServerOptions;
  const managers: LanguageServerManager[] = [];
  const preset: LanguageServerPreset = {
    id: 'fake',
    name: 'Fake',
    languages: ['fake'],
    extensions: { '.fk': 'fake' },
    rootMarkers: [],
    resolveLaunch: root => ({ command: 'fake', args: [], cwd: root }),
  };

  function createManager(overrides: LanguageServerManagerOptions = {}) {
    const manager = new LanguageServerManager({
      presets: [preset],
      settleMs: 5,
      spawn: async () => {
        const server = createFakeServer(serverOptions);
        servers.push(server);
        return server.transport;
      },
      ...overrides,
    });
    managers.push(manager);
    return manager;
  }

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'lsp-query-'));
    servers = [];
    serverOptions = {};
  });
  afterEach(async () => {
    await Promise.all(managers.splice(0).map(m => m.dispose()));
    rmSync(dir, { recursive: true, force: true });
  });

  it('answers positional queries with 0-based positions sent and previews returned', async () => {
    const manager = createManager();
    const file = path.join(dir, 'a.fk');
    writeFileSync(file, 'head\nREF one\n');
    const hover = await manager.query({ cwd: dir, action: 'hover', file, line: 2, character: 5 });
    expect(hover).toEqual({ action: 'hover', contents: 'hover 1:4' });

    const refs = await manager.query({
      cwd: dir,
      action: 'references',
      file,
      line: 2,
      character: 1,
    });
    expect(refs).toMatchObject({
      action: 'references',
      locations: [{ file: 'a.fk', line: 2, preview: 'REF one' }],
    });
  });

  it('re-syncs from disk, so edits made outside Edit/Write are seen', async () => {
    const manager = createManager();
    const file = path.join(dir, 'a.fk');
    writeFileSync(file, 'REF\n');
    const before = await manager.query({
      cwd: dir,
      action: 'references',
      file,
      line: 1,
      character: 1,
    });
    writeFileSync(file, 'REF\nREF\nREF\n'); // e.g. a Bash `sed`
    const after = await manager.query({
      cwd: dir,
      action: 'references',
      file,
      line: 1,
      character: 1,
    });
    expect(before.action === 'references' && before.locations).toHaveLength(1);
    expect(after.action === 'references' && after.locations).toHaveLength(3);
  });

  it('maps call hierarchy into callers with call sites', async () => {
    const manager = createManager();
    const file = path.join(dir, 'a.fk');
    writeFileSync(file, 'callee\n\ncaller\n    callee()\n');
    const result = await manager.query({
      cwd: dir,
      action: 'incomingCalls',
      file,
      line: 1,
      character: 1,
    });
    expect(result).toMatchObject({
      action: 'incomingCalls',
      calls: [
        {
          caller: { name: 'caller', kind: 'function', location: { line: 3 } },
          callSites: [{ line: 4, character: 5, preview: 'callee()' }],
        },
      ],
    });
  });

  it('refuses actions the server did not advertise', async () => {
    serverOptions = { capabilities: { callHierarchyProvider: false } };
    const manager = createManager();
    const file = path.join(dir, 'a.fk');
    writeFileSync(file, 'x\n');
    await expect(
      manager.query({ cwd: dir, action: 'incomingCalls', file, line: 1, character: 1 })
    ).rejects.toMatchObject({ code: 'unsupported_action' });
  });

  it('answers server_starting when the server is slower than the start wait', async () => {
    serverOptions = { initializeDelayMs: 200 };
    const manager = createManager({ startWaitMs: 20 });
    const file = path.join(dir, 'a.fk');
    writeFileSync(file, 'x\n');
    const error = await manager
      .query({ cwd: dir, action: 'hover', file, line: 1, character: 1 })
      .catch(err => err);
    expect(error).toBeInstanceOf(LanguageServerError);
    expect(error.code).toBe('server_starting');
  });

  it('condenses server errors to their first lines, without the stack', async () => {
    const manager = createManager();
    const file = path.join(dir, 'a.fk');
    writeFileSync(file, 'THROW\n');
    const error = await manager
      .query({ cwd: dir, action: 'hover', file, line: 1, character: 1 })
      .catch(err => err);
    expect(error.code).toBe('request_failed');
    expect(error.message).toBe('Fake Server Error No Project.');
  });

  it('loads a project from a source file before a workspace search with nothing open', async () => {
    const manager = createManager();
    writeFileSync(path.join(dir, 'a.fk'), 'x\n');
    const result = await manager.query({ cwd: dir, action: 'workspaceSymbols', query: 'thing' });
    expect(result).toMatchObject({
      action: 'workspaceSymbols',
      symbols: [{ name: 'thing', location: { file: 'a.fk' } }],
    });
    expect(servers[0].received.some(r => r.method === 'didOpen')).toBe(true);
  });

  it('says what a workspace search covered when it finds nothing', async () => {
    serverOptions = { noWorkspaceSymbols: true };
    const manager = createManager();
    writeFileSync(path.join(dir, 'a.fk'), 'x\n');
    const result = await manager.query({ cwd: dir, action: 'workspaceSymbols', query: 'gone' });
    expect(result).toMatchObject({ action: 'workspaceSymbols', symbols: [] });
    expect(result.action === 'workspaceSymbols' && result.note).toContain(
      'Searched only the projects of the 1 file(s) opened so far'
    );
  });

  it('reports diagnostics with their state', async () => {
    const manager = createManager();
    const file = path.join(dir, 'a.fk');
    writeFileSync(file, 'ERR: broken\n');
    expect(await manager.query({ cwd: dir, action: 'diagnostics', file })).toMatchObject({
      action: 'diagnostics',
      state: 'ready',
      diagnostics: [{ message: 'broken', line: 1 }],
    });
  });
});
