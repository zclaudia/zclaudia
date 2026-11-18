#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import process from 'process';
import { fileURLToPath } from 'url';

const repoRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const nodeVersionFile = path.join(repoRoot, '.node-version');

/** Matches package.json engines.node. Vercel cannot pin the .node-version patch. */
export const MINIMUM_NODE_VERSION = '22.19.0';

export function normalize(version) {
  return String(version).trim().replace(/^v/, '');
}

function readExpectedVersion() {
  return normalize(fs.readFileSync(nodeVersionFile, 'utf8'));
}

function compareVersions(left, right) {
  const a = normalize(left)
    .split('.')
    .map(part => Number(part) || 0);
  const b = normalize(right)
    .split('.')
    .map(part => Number(part) || 0);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const av = a[index] ?? 0;
    const bv = b[index] ?? 0;
    if (av !== bv) return av > bv ? 1 : -1;
  }
  return 0;
}

/**
 * Local installs must match .node-version exactly. Vercel only offers a Node
 * major (22.x / 24.x / 26.x), so there the project minimum is enough.
 */
export function isNodeVersionAllowed({ current, expected, vercel }) {
  if (vercel) return compareVersions(current, MINIMUM_NODE_VERSION) >= 0;
  return normalize(current) === normalize(expected);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function main() {
  const expected = readExpectedVersion();
  const current = normalize(process.version);
  const vercel = Boolean(process.env.VERCEL);

  if (isNodeVersionAllowed({ current, expected, vercel })) return;

  if (vercel) {
    fail(
      [
        `Node ${current} is below the minimum ${MINIMUM_NODE_VERSION} required for Vercel installs.`,
        `Local installs still require exactly ${expected} from .node-version.`,
      ].join('\n')
    );
  }

  fail(
    [
      `Node version mismatch: expected ${expected}, current ${current}.`,
      'Use the project runtime before installing dependencies or running tests.',
      `Suggested fix: eval "$(fnm env)" && fnm use ${expected}`,
      `Or run one-off: fnm exec --using ${expected} pnpm test`,
    ].join('\n')
  );
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (entry === fileURLToPath(import.meta.url)) main();
