import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runArchitectureChecks } from '../check-architecture-boundaries.mjs';

function createFixture(files) {
  const root = mkdtempSync(path.join(tmpdir(), 'zclaudia-arch-'));
  for (const [relativePath, content] of Object.entries(files)) {
    const fullPath = path.join(root, relativePath);
    mkdirSync(path.dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, content);
  }
  return root;
}

test('fails when services api barrel re-exports feature APIs', () => {
  const root = createFixture({
    'apps/desktop/src/services/api.ts': "export * from '../features/new-feature/api';\n",
    'server/src/domains/projects/routes.ts': 'export const ok = true;\n',
  });

  const failures = runArchitectureChecks(root);

  assert.deepEqual(failures, [
    'apps/desktop/src/services/api.ts: Do not re-export feature APIs from services/api; import feature APIs directly from the owning feature.',
  ]);
});

test('fails when shared components import feature modules without an allowlist entry', () => {
  const root = createFixture({
    'apps/desktop/src/components/notifications/NotificationItem.tsx':
      "import { extractThinking } from '../../features/chat/MessageList';\n",
    'server/src/domains/projects/routes.ts': 'export const ok = true;\n',
  });

  const failures = runArchitectureChecks(root, {
    desktopComponentFeatureImportAllowlist: [],
  });

  assert.deepEqual(failures, [
    'apps/desktop/src/components/notifications/NotificationItem.tsx: Do not import feature modules from shared components; move shared code to components, hooks, services, or utils.',
  ]);
});

test('fails by default when SettingsPanel remains a shared component importing features', () => {
  const root = createFixture({
    'apps/desktop/src/components/SettingsPanel.tsx':
      "import { GeneralSettings } from '../features/settings/GeneralSettings';\n",
    'server/src/domains/projects/routes.ts': 'export const ok = true;\n',
  });

  const failures = runArchitectureChecks(root);

  assert.deepEqual(failures, [
    'apps/desktop/src/components/SettingsPanel.tsx: Do not import feature modules from shared components; move shared code to components, hooks, services, or utils.',
  ]);
});

test('fails when new code reads legacy selection fields from projectStore', () => {
  const root = createFixture({
    'apps/desktop/src/features/example/Example.tsx':
      'const selected = useProjectStore((s) => s.selectedSessionId);\n',
    'server/src/domains/projects/routes.ts': 'export const ok = true;\n',
  });

  const failures = runArchitectureChecks(root);

  assert.deepEqual(failures, [
    'apps/desktop/src/features/example/Example.tsx: Do not read selectedSessionId from projectStore; use selectionStore instead.',
  ]);
});

test('fails when route-like domain files issue raw SQL', () => {
  const root = createFixture({
    'server/src/domains/sessions/drafts-routes.ts':
      'export function route(deps) { deps.db.prepare("SELECT 1"); }\n',
    'server/src/domains/supervision/register.ts':
      'export function register(context) { context.db.transaction(() => {})(); }\n',
  });

  const failures = runArchitectureChecks(root);

  assert.deepEqual(failures, [
    'server/src/domains/sessions/drafts-routes.ts: Do not issue raw SQL in domain route/register/handler files; move persistence to repository or service.',
    'server/src/domains/supervision/register.ts: Do not issue DB transactions in domain route/register/handler files; move persistence to repository or service.',
  ]);
});
