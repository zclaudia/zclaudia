#!/usr/bin/env node

/**
 * Radius conventions guard — keeps the three-tier radius system intact:
 *
 *   control tier  : rounded-md  (inputs, selects, buttons, checkboxes)
 *   panel tier    : rounded-xl  (dropdown panels, menus, popovers)
 *   chrome tier   : rounded-2xl (modals, composer)
 *   rounded-full  : decorative only (toggle, status dots, chips, badges)
 *
 * Enforced rules:
 *   1. No `!rounded-` important overrides — radius belongs to the primitive.
 *   2. No `rounded-full` on an interactive field (a line that also carries a
 *      focus/focus-within marker). Pills are for decoration, not data entry.
 *   3. No radius in Select's triggerClassName/panelClassName overrides.
 *   4. The Select primitive itself never uses rounded-full.
 *
 * Escape hatch: append `radius-ok` in a comment on the offending line.
 */

import fs from 'node:fs';
import path from 'node:path';

const projectRoot = path.resolve(import.meta.dirname, '..');
const sourceRoot = path.join(projectRoot, 'src');
const selectPrimitive = path.join(sourceRoot, 'components', 'ui', 'Select.tsx');
const failures = [];

const FIELD_MARKERS = ['focus:outline-none', 'focus:ring', 'focus:border', 'focus-within:'];

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(absolute);
    if (!/\.[jt]sx?$/.test(entry.name) || /\.test\.[jt]sx?$/.test(entry.name)) return [];
    return [absolute];
  });
}

for (const file of walk(sourceRoot)) {
  const relative = path.relative(projectRoot, file);
  const lines = fs.readFileSync(file, 'utf8').split('\n');

  lines.forEach((line, index) => {
    if (line.includes('radius-ok')) return;
    const at = `${relative}:${index + 1}`;

    if (/!rounded-/.test(line)) {
      failures.push(`${at}: no !rounded- important overrides — fix the primitive instead`);
    }
    if (line.includes('rounded-full') && FIELD_MARKERS.some(m => line.includes(m))) {
      failures.push(
        `${at}: rounded-full on an interactive field — controls use rounded-md (see docs/ui-conventions.md §9)`
      );
    }
    if (/(?:triggerClassName|panelClassName)=["'{`][^"'{`]*rounded/.test(line)) {
      failures.push(
        `${at}: no radius in Select className overrides — the primitive owns its radius`
      );
    }
  });
}

if (!fs.readFileSync(selectPrimitive, 'utf8').includes('rounded-md')) {
  failures.push(
    'src/components/ui/Select.tsx: trigger lost its rounded-md — the control-tier radius lives here'
  );
}
if (fs.readFileSync(selectPrimitive, 'utf8').includes('rounded-full')) {
  failures.push(
    'src/components/ui/Select.tsx: rounded-full is not allowed in the Select primitive'
  );
}

if (failures.length > 0) {
  console.error(`Radius conventions violated:\n${failures.map(f => `  ${f}`).join('\n')}`);
  process.exit(1);
}
console.log('Radius conventions OK');
