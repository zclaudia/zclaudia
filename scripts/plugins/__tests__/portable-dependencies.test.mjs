import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { copyPortableDependencies } from '../portable-dependencies.mjs';
import { inventoryPlugin } from '../artifact-integrity.mjs';

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'portable-dependencies-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = path.join(directory, 'source');
  const output = path.join(directory, 'relocated 中文 app');
  await mkdir(source);
  async function pkg(name, manifest, code = 'module.exports = {};') {
    const dir = path.join(source, name);
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, 'package.json'),
      JSON.stringify({ name, main: 'index.cjs', ...manifest })
    );
    await writeFile(path.join(dir, 'index.cjs'), code);
    return dir;
  }
  async function link(from, name, to) {
    const target = path.join(from, 'node_modules', name);
    await mkdir(path.dirname(target), { recursive: true });
    await symlink(path.relative(path.dirname(target), to), target, 'dir');
  }
  return { source, output, pkg, link };
}

test('relocated graph retains conflicting versions, peer context, cycles and assets without links', async t => {
  const { source, output, pkg, link } = await fixture(t);
  const root = await pkg('app', { dependencies: { alpha: '*', beta: '*', '@scope/sdk': '*' } });
  const alpha = await pkg(
    'alpha',
    { dependencies: { shared: '*', beta: '*' } },
    "exports.version = require('shared'); exports.beta = () => require('beta');"
  );
  const beta = await pkg(
    'beta',
    { dependencies: { shared: '*', alpha: '*' } },
    "exports.version = require('shared'); exports.alpha = () => require('alpha');"
  );
  const shared1 = await pkg(
    'shared1',
    { name: 'shared', version: '1.0.0' },
    "module.exports = 'v1';"
  );
  const shared2 = await pkg(
    'shared2',
    { name: 'shared', version: '2.0.0' },
    "module.exports = 'v2';"
  );
  const sdk = await pkg(
    'sdk',
    { name: '@scope/sdk', peerDependencies: { shared: '*' } },
    "module.exports = require('shared');"
  );
  await link(root, 'alpha', alpha);
  await link(root, 'beta', beta);
  await link(root, '@scope/sdk', sdk);
  await link(alpha, 'shared', shared1);
  await link(alpha, 'beta', beta);
  await link(beta, 'shared', shared2);
  await link(beta, 'alpha', alpha);
  await link(sdk, 'shared', shared2);
  await writeFile(path.join(sdk, 'tool.sh'), '#!/bin/sh\necho portable\n');
  await chmod(path.join(sdk, 'tool.sh'), 0o755);
  await copyPortableDependencies(root, path.join(output, 'node_modules'), source);
  await rm(source, { recursive: true });
  await writeFile(
    path.join(output, 'check.cjs'),
    `
    const assert = require('node:assert/strict');
    const alpha = require('alpha'), beta = require('beta');
    assert.equal(alpha.version, 'v1');
    assert.equal(beta.version, 'v2');
    assert.equal(require('@scope/sdk'), 'v2');
    assert.equal(alpha.beta(), beta);
    assert.equal(beta.alpha(), alpha);
  `
  );
  execFileSync(process.execPath, [path.join(output, 'check.cjs')], { cwd: tmpdir() });
  const inventory = await inventoryPlugin(output);
  assert.ok(inventory.files.every(file => !file.link));
  assert.equal(inventory.files.find(file => file.path.endsWith('tool.sh')).executable, true);
  assert.equal(
    await readFile(path.join(output, 'node_modules/@scope/sdk/tool.sh'), 'utf8'),
    '#!/bin/sh\necho portable\n'
  );
});

test('omits optional CLI binaries and dev dependencies while accepting absent optional peers', async t => {
  const { source, output, pkg, link } = await fixture(t);
  const root = await pkg('app', {
    dependencies: { library: '*', optional: '*' },
    optionalDependencies: { optional: '*' },
    devDependencies: { development: '*' },
    peerDependencies: { absent: '*' },
    peerDependenciesMeta: { absent: { optional: true } },
  });
  const library = await pkg('library', { version: '1.0.0' });
  await link(root, 'library', library);
  await link(root, 'optional', await pkg('optional', {}));
  await link(root, 'development', await pkg('development', {}));
  await copyPortableDependencies(root, path.join(output, 'node_modules'), source);
  const inventory = await inventoryPlugin(output);
  assert.deepEqual(
    inventory.dependencies.map(item => item.name),
    ['library']
  );
});

test('rejects a missing required package and a dependency outside the source boundary', async t => {
  const { source, output, pkg, link } = await fixture(t);
  const root = await pkg('app', { dependencies: { missing: '*' } });
  await assert.rejects(
    copyPortableDependencies(root, output, source),
    /Missing production dependency/
  );
  await mkdir(output);
  await link(root, 'missing', output);
  await assert.rejects(copyPortableDependencies(root, output, source), /escapes source tree/);
});

test('rejects asset symlinks rather than creating a package Tauri would truncate', async t => {
  const { source, output, pkg, link } = await fixture(t);
  const root = await pkg('app', { dependencies: { library: '*' } });
  const library = await pkg('library', {});
  await link(root, 'library', library);
  await symlink('index.cjs', path.join(library, 'asset.cjs'));
  await assert.rejects(
    copyPortableDependencies(root, output, source),
    /Unsupported package asset symlink/
  );
});
