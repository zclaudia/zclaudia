import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { isNodeVersionAllowed } from '../ensure-node-version.mjs';

const script = path.resolve(import.meta.dirname, '../ensure-node-version.mjs');

test('local installs require the exact .node-version pin', () => {
  assert.equal(
    isNodeVersionAllowed({ current: '22.20.0', expected: '22.20.0', vercel: false }),
    true
  );
  assert.equal(
    isNodeVersionAllowed({ current: 'v22.20.0', expected: '22.20.0', vercel: false }),
    true
  );
  assert.equal(
    isNodeVersionAllowed({ current: '22.23.4', expected: '22.20.0', vercel: false }),
    false
  );
  assert.equal(
    isNodeVersionAllowed({ current: '26.1.0', expected: '22.20.0', vercel: false }),
    false
  );
});

test('Vercel accepts any Node at or above 22.19.0', () => {
  for (const current of ['22.19.0', '22.20.0', '22.23.4', '24.11.0', '26.1.0']) {
    assert.equal(
      isNodeVersionAllowed({ current, expected: '22.20.0', vercel: true }),
      true,
      current
    );
  }
  for (const current of ['22.18.9', '21.9.0', '20.19.0']) {
    assert.equal(
      isNodeVersionAllowed({ current, expected: '22.20.0', vercel: true }),
      false,
      current
    );
  }
});

test('the hook process keeps the exact pin unless VERCEL is set', () => {
  const env = { ...process.env };
  delete env.VERCEL;
  const current = process.version.replace(/^v/, '');

  const local = spawnSync(process.execPath, [script], { env, encoding: 'utf8' });
  if (current === '22.20.0') {
    assert.equal(local.status, 0, local.stderr);
  } else {
    assert.equal(local.status, 1, local.stderr);
    assert.match(local.stderr, /expected 22\.20\.0/);
    assert.match(local.stderr, new RegExp(current.replaceAll('.', '\\.')));
  }

  const vercel = spawnSync(process.execPath, [script], {
    env: { ...env, VERCEL: '1' },
    encoding: 'utf8',
  });
  assert.equal(vercel.status, 0, vercel.stderr);
});
