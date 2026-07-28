#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const projectRoot = path.resolve(import.meta.dirname, '..');
const sourceRoot = path.join(projectRoot, 'src');
const allowedMountedRefFile = path.join(sourceRoot, 'hooks', 'useIsMounted.ts');
const runFinalizationFile = path.join(
  sourceRoot,
  'services',
  'message-handlers',
  'run-finalization.ts'
);
const deltaBufferFile = path.join(sourceRoot, 'services', 'message-handlers', 'delta-buffer.ts');
const failures = [];

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(absolute);
    if (!/\.[jt]sx?$/.test(entry.name) || /\.test\.[jt]sx?$/.test(entry.name)) return [];
    return [absolute];
  });
}

function isUseRefCall(node) {
  if (!ts.isCallExpression(node)) return false;
  if (ts.isIdentifier(node.expression)) return node.expression.text === 'useRef';
  return ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'useRef';
}

for (const file of walk(sourceRoot)) {
  const sourceText = fs.readFileSync(file, 'utf8');
  const sourceFile = ts.createSourceFile(
    file,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );

  function visit(node) {
    if (
      file !== allowedMountedRefFile &&
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      /^(?:is)?mountedRef$/i.test(node.name.text) &&
      node.initializer &&
      isUseRefCall(node.initializer)
    ) {
      const { line } = sourceFile.getLineAndCharacterOfPosition(node.name.getStart(sourceFile));
      failures.push(
        `${path.relative(projectRoot, file)}:${line + 1}: use shared useIsMounted() instead of a bespoke mounted ref`
      );
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);

  const lines = sourceText.split(/\r?\n/);
  lines.forEach((line, index) => {
    const match = line.match(/cancelAnimationFrame\(\s*([A-Za-z_$][\w$]*(?:\.current)?)\s*\)/);
    if (!match) return;
    const handle = match[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const resetPattern = new RegExp(`${handle}\\s*=\\s*null`);
    const nearbyCleanup = lines.slice(index, index + 7).join('\n');
    if (!resetPattern.test(nearbyCleanup)) {
      failures.push(
        `${path.relative(projectRoot, file)}:${index + 1}: clear the animation-frame handle to null immediately after cancellation`
      );
    }
  });

  if (file !== runFinalizationFile) {
    lines.forEach((line, index) => {
      if (/\.finalizeRunToMessage\(|\.endRun\(/.test(line)) {
        failures.push(
          `${path.relative(projectRoot, file)}:${index + 1}: use finalizeRunLifecycle() for terminal run cleanup`
        );
      }
    });
  }

  if (file !== runFinalizationFile && file !== deltaBufferFile) {
    lines.forEach((line, index) => {
      if (/\bflushDeltaForRun\(/.test(line)) {
        failures.push(
          `${path.relative(projectRoot, file)}:${index + 1}: buffered deltas may only be flushed by finalizeRunLifecycle()`
        );
      }
    });
  }
}

if (failures.length > 0) {
  console.error('[react-lifecycle-invariants] Failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('[react-lifecycle-invariants] OK');
