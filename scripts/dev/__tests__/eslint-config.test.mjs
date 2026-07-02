import assert from 'node:assert/strict';
import test from 'node:test';

import eslintConfig from '../../../eslint.config.mjs';

function findOverrideForFile(pattern) {
  return eslintConfig.find(entry => entry.files?.some(filePattern => filePattern === pattern));
}

test('test file override disables low-signal TypeScript assertion rules', () => {
  const override = findOverrideForFile('**/*.test.{ts,tsx}');

  assert.ok(override, 'expected a dedicated test-file override');
  assert.equal(override.rules['@typescript-eslint/no-explicit-any'], 'off');
  assert.equal(override.rules['@typescript-eslint/no-non-null-assertion'], 'off');
});

test('test support override covers non-test helper modules', () => {
  const override = findOverrideForFile('apps/desktop/src/test/**/*.{ts,tsx}');

  assert.ok(override, 'expected test support helpers to use test-file lint rules');
  assert.equal(override.rules['@typescript-eslint/no-explicit-any'], 'off');
  assert.equal(override.rules['@typescript-eslint/no-non-null-assertion'], 'off');
});
