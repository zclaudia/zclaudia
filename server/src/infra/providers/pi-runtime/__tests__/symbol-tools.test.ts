import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

import { buildTools } from '../tool-bridge.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getTools(dir: string): Record<string, any> {
  const tools = buildTools(dir, { enabled: ['ReadSymbol', 'EditSymbol'] });
  return Object.fromEntries(tools.map(tool => [tool.name, tool]));
}

describe('ReadSymbol/EditSymbol', () => {
  it('declares path requirements in both symbol tool schemas', () => {
    const tools = getTools('/tmp');

    expect(tools.ReadSymbol.parameters).toMatchObject({
      required: ['symbol'],
      anyOf: [
        { required: ['file_path'] },
        { required: ['path'] },
      ],
    });
    expect(tools.EditSymbol.parameters).toMatchObject({
      required: ['symbol', 'new_body'],
      anyOf: [
        { required: ['file_path'] },
        { required: ['path'] },
      ],
    });
  });

  it('reads a qualified Python method and records an editable snapshot', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-symbol-'));
    writeFileSync(path.join(dir, 'worker.py'), [
      'class Worker:',
      '    def run(self):',
      '        return 1',
      '',
      'def run():',
      '    return 2',
      '',
    ].join('\n'));
    const tools = getTools(dir);

    const res = await tools.ReadSymbol.execute('rs1', {
      file_path: 'worker.py',
      symbol: 'Worker.run',
    });

    rmSync(dir, { recursive: true, force: true });
    expect(res.details).toMatchObject({
      ok: true,
      path: 'worker.py',
      symbol: 'Worker.run',
      kind: 'method',
      startLine: 2,
      endLine: 3,
      state: {
        fullContentCaptured: true,
        partialView: true,
      },
    });
    expect(res.details.bodyDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(res.content[0].text).toContain('2|    def run(self):');
    expect(res.content[0].text).toContain('3|        return 1');
  });

  it('edits a TypeScript class method after ReadSymbol without a separate full Read', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-symbol-'));
    writeFileSync(path.join(dir, 'client.ts'), [
      'export class Client {',
      '  connect() {',
      '    return 1;',
      '  }',
      '}',
      '',
    ].join('\n'));
    const tools = getTools(dir);

    const read = await tools.ReadSymbol.execute('rs1', {
      file_path: 'client.ts',
      symbol: 'Client.connect',
    });
    const edit = await tools.EditSymbol.execute('es1', {
      file_path: 'client.ts',
      symbol: 'Client.connect',
      expected_body_digest: read.details.bodyDigest,
      new_body: [
        '  connect() {',
        '    return 2;',
        '  }',
        '',
      ].join('\n'),
    });
    const onDisk = readFileSync(path.join(dir, 'client.ts'), 'utf8');

    rmSync(dir, { recursive: true, force: true });
    expect(edit.details).toMatchObject({
      ok: true,
      symbol: 'Client.connect',
      symbolKind: 'method',
      previousBodyDigest: read.details.bodyDigest,
    });
    expect(edit.details.newBodyDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(edit.content[0].text).toContain('Edited client.ts');
    expect(onDisk).toContain('return 2;');
  });

  it('edits an expression-bodied arrow variable without replacing the following symbol', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-symbol-'));
    const file = path.join(dir, 'client.ts');
    writeFileSync(file, [
      'export const f = () => 1;',
      '',
      'export function g() {',
      '  return 2;',
      '}',
      '',
    ].join('\n'));
    const tools = getTools(dir);

    const read = await tools.ReadSymbol.execute('rs-arrow', {
      file_path: 'client.ts',
      symbol: 'f',
    });
    const edit = await tools.EditSymbol.execute('es-arrow', {
      file_path: 'client.ts',
      symbol: 'f',
      expected_body_digest: read.details.bodyDigest,
      new_body: 'export const f = () => 10;\n',
    });
    const onDisk = readFileSync(file, 'utf8');

    rmSync(dir, { recursive: true, force: true });
    expect(read.details).toMatchObject({ ok: true, startLine: 1, endLine: 1, kind: 'variable' });
    expect(read.content[0].text).not.toContain('export function g');
    expect(edit.details).toMatchObject({ ok: true, symbol: 'f', replaced: 1 });
    expect(onDisk).toBe([
      'export const f = () => 10;',
      '',
      'export function g() {',
      '  return 2;',
      '}',
      '',
    ].join('\n'));
  });

  it('ignores braces inside regex literals when reading and editing a TypeScript function', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-symbol-'));
    const file = path.join(dir, 'client.ts');
    writeFileSync(file, [
      'export function matcher(value: string) {',
      '  if (/}/.test(value)) {',
      '    return "close";',
      '  }',
      '  return "open";',
      '}',
      '',
      'export function next() {',
      '  return 2;',
      '}',
      '',
    ].join('\n'));
    const tools = getTools(dir);

    const read = await tools.ReadSymbol.execute('rs-regex', {
      file_path: 'client.ts',
      symbol: 'matcher',
    });
    const edit = await tools.EditSymbol.execute('es-regex', {
      file_path: 'client.ts',
      symbol: 'matcher',
      expected_body_digest: read.details.bodyDigest,
      new_body: [
        'export function matcher(value: string) {',
        '  return "changed";',
        '}',
        '',
      ].join('\n'),
    });
    const onDisk = readFileSync(file, 'utf8');

    rmSync(dir, { recursive: true, force: true });
    expect(read.details).toMatchObject({ ok: true, startLine: 1, endLine: 6 });
    expect(read.content[0].text).toContain('5|  return "open";');
    expect(read.content[0].text).not.toContain('export function next');
    expect(edit.details).toMatchObject({ ok: true, symbol: 'matcher', replaced: 1 });
    expect(onDisk).toBe([
      'export function matcher(value: string) {',
      '  return "changed";',
      '}',
      '',
      'export function next() {',
      '  return 2;',
      '}',
      '',
    ].join('\n'));
  });

  it('rejects EditSymbol when the expected body digest is stale', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-symbol-'));
    const file = path.join(dir, 'client.ts');
    writeFileSync(file, [
      'export function connect() {',
      '  return 1;',
      '}',
      '',
    ].join('\n'));
    const tools = getTools(dir);

    const read = await tools.ReadSymbol.execute('rs1', {
      file_path: 'client.ts',
      symbol: 'connect',
    });
    writeFileSync(file, [
      'export function connect() {',
      '  return 99;',
      '}',
      '',
    ].join('\n'));
    const edit = await tools.EditSymbol.execute('es1', {
      file_path: 'client.ts',
      symbol: 'connect',
      expected_body_digest: read.details.bodyDigest,
      new_body: 'export function connect() {\n  return 2;\n}\n',
    });
    const onDisk = readFileSync(file, 'utf8');

    rmSync(dir, { recursive: true, force: true });
    expect(edit.details).toMatchObject({
      ok: false,
      error: 'stale_symbol',
      retryable: true,
      suggestedAction: 'read_symbol',
      expectedBodyDigest: read.details.bodyDigest,
    });
    expect(onDisk).toContain('return 99;');
  });

  it('reports ambiguous unqualified symbols with qualified candidates', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-symbol-'));
    writeFileSync(path.join(dir, 'client.ts'), [
      'class A {',
      '  run() {}',
      '}',
      'class B {',
      '  run() {}',
      '}',
      '',
    ].join('\n'));
    const tools = getTools(dir);

    const res = await tools.ReadSymbol.execute('rs1', {
      file_path: 'client.ts',
      symbol: 'run',
    });

    rmSync(dir, { recursive: true, force: true });
    expect(res.details).toMatchObject({
      ok: false,
      error: 'ambiguous_symbol',
      candidates: [
        expect.objectContaining({ symbol: 'A.run' }),
        expect.objectContaining({ symbol: 'B.run' }),
      ],
    });
  });
});
