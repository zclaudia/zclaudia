import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_DESKTOP_COMPONENT_FEATURE_IMPORT_ALLOWLIST = [];

const DEFAULT_DESKTOP_LEGACY_PROJECT_STORE_ALLOWLIST = [
  // Existing migration targets. New code should use selectionStore directly.
];

const DEFAULT_DESKTOP_SERVICES_FEATURE_API_REEXPORT_ALLOWLIST = [
  // Existing migration targets for phase 2 of the apps architecture cleanup.
];

// ---------------------------------------------------------------------------
// Layer direction rules (ratchet style).
//
// Each allowlist entry is `'importer -> target'` where both sides are repo
// relative paths. The lists freeze the violations that existed when the rule
// was introduced so no NEW violations can be added; burn entries down by
// fixing the importer and removing its line. Generate a fresh baseline with:
//   node scripts/dev/check-architecture-boundaries.mjs --report
// ---------------------------------------------------------------------------

// Server layer order (low -> high). A file may only import downwards or
// sideways. `root` is the composition-root files directly in server/src.
const SERVER_LAYER_ORDER = ['utils', 'infra', 'domains', 'application', 'interfaces', 'root'];

// server: infra must not import domains/application/interfaces/root,
// domains must not import application/interfaces/root, application must not
// import interfaces/root, utils must not import anything above it.
const DEFAULT_SERVER_LAYER_VIOLATION_ALLOWLIST = new Set([
  'server/src/domains/workflows/step-executors/workflow-agent-permissions.ts -> server/src/application/conversation/agent/permission-evaluator.ts',
  'server/src/domains/workflows/step-executors/workflow-agent-runtime-resolver.ts -> server/src/application/conversation/context/engine.ts',
  'server/src/domains/workflows/step-executors/workflow-agent-runtime-resolver.ts -> server/src/application/conversation/context/memory-context.ts',
  'server/src/domains/workflows/step-executors/workflow-agent-runtime-resolver.ts -> server/src/application/conversation/runtime/resolve-user-hooks.ts',
  'server/src/domains/workflows/step-executors/workflow-agent-runtime-resolver.ts -> server/src/application/plugins/index.ts',
  'server/src/domains/workflows/step-executors/workflow-agent-runtime-resolver.ts -> server/src/application/services/workspace.ts',
  'server/src/infra/providers/pi-runtime/agent-loop/lightweight-agent-runner.ts -> server/src/domains/agent-loop/index.ts',
  'server/src/infra/providers/pi-runtime/agent-loop/lightweight-agent-runner.ts -> server/src/domains/llm-profiles/repository.ts',
  'server/src/infra/providers/pi-runtime/agent-loop/toolsets.ts -> server/src/domains/agent-loop/index.ts',
  'server/src/infra/providers/pi-runtime/bash-tool.ts -> server/src/domains/tasks/executors/command-executor.ts',
  'server/src/infra/providers/pi-runtime/bash-tool.ts -> server/src/domains/tasks/repository.ts',
  'server/src/infra/providers/pi-runtime/bash-tool.ts -> server/src/domains/tasks/task-service.ts',
  'server/src/infra/providers/pi-runtime/build-model.ts -> server/src/domains/llm-profiles/codex-oauth-service.ts',
  'server/src/infra/providers/pi-runtime/command-task-runtime.ts -> server/src/domains/tasks/executors/command-executor.ts',
  'server/src/infra/providers/pi-runtime/command-task-runtime.ts -> server/src/domains/tasks/repository.ts',
  'server/src/infra/providers/pi-runtime/command-task-runtime.ts -> server/src/domains/tasks/task-service.ts',
  'server/src/infra/providers/pi-runtime/eval-task-runtime.ts -> server/src/domains/tasks/executors/command-executor.ts',
  'server/src/infra/providers/pi-runtime/eval-task-runtime.ts -> server/src/domains/tasks/repository.ts',
  'server/src/infra/providers/pi-runtime/eval-task-runtime.ts -> server/src/domains/tasks/task-service.ts',
  'server/src/infra/providers/pi-runtime/eval-tool.ts -> server/src/domains/tasks/repository.ts',
  'server/src/infra/providers/pi-runtime/eval-tool.ts -> server/src/domains/tasks/task-service.ts',
  'server/src/infra/providers/pi-runtime/mode-tools.ts -> server/src/application/conversation/interactions/interaction-dispatcher.ts',
  'server/src/infra/providers/pi-runtime/mode-tools.ts -> server/src/domains/sessions/plan-mode-toggle.ts',
  'server/src/infra/providers/pi-runtime/mode-tools.ts -> server/src/domains/sessions/repository.ts',
  'server/src/infra/providers/pi-runtime/models-registry.ts -> server/src/domains/llm-profiles/codex-oauth-pi.ts',
  'server/src/infra/providers/pi-runtime/skills.ts -> server/src/application/plugins/skill-tools.ts',
  'server/src/infra/providers/pi-runtime/task-tools.ts -> server/src/domains/tasks/repository.ts',
  'server/src/infra/providers/pi-runtime/task-tools.ts -> server/src/domains/tasks/task-service.ts',
]);

// desktop: a store file may not import another store file (cross-store
// coordination belongs in services/consumers, shared types in a types module).
const DEFAULT_DESKTOP_STORE_IMPORT_ALLOWLIST = new Set([
  // Cleared 2026-09-18: store-to-store imports are banned outright;
  // cross-store coordination lives in services/*-coordination.ts.
]);

// desktop: a file inside features/<name>/ may not import features/<other>/.
const DEFAULT_DESKTOP_FEATURE_IMPORT_ALLOWLIST = new Set([
  // Cleared 2026-09-18: cross-feature imports must target the other
  // feature's public entry (index.ts / api.ts / *-types.ts).
]);

// desktop: services/** may not re-export feature APIs (directly or through a
// secondary file); consumers import the owning feature module directly.
const DEFAULT_DESKTOP_SERVICES_REEXPORT_ALLOWLIST = new Set([
  // BASELINE-TODO: populated below after first --report run.
]);

function read(repoRoot, relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function walk(repoRoot, relativeDir, predicate) {
  const root = path.join(repoRoot, relativeDir);
  const results = [];
  if (!existsSync(root)) return results;

  function visit(currentDir) {
    for (const entry of readdirSync(currentDir)) {
      const fullPath = path.join(currentDir, entry);
      const relativePath = path.relative(repoRoot, fullPath).replaceAll(path.sep, '/');
      const stats = statSync(fullPath);

      if (stats.isDirectory()) {
        visit(fullPath);
        continue;
      }

      if (predicate(relativePath)) {
        results.push(relativePath);
      }
    }
  }

  visit(root);
  return results;
}

function assertNoMatch(repoRoot, failures, relativePath, pattern, message) {
  const content = read(repoRoot, relativePath);
  if (pattern.test(content)) {
    failures.push(`${relativePath}: ${message}`);
  }
}

function isSourceFile(relativePath) {
  return (
    (relativePath.endsWith('.ts') || relativePath.endsWith('.tsx')) &&
    !relativePath.includes('/__tests__/') &&
    !relativePath.includes('/test/')
  );
}

const IMPORT_SOURCE_PATTERN = /\bfrom\s*['"]([^'"]+)['"]|^\s*import\s*['"]([^'"]+)['"]/gm;

function extractImportSources(content) {
  const sources = [];
  for (const match of content.matchAll(IMPORT_SOURCE_PATTERN)) {
    sources.push(match[1] ?? match[2]);
  }
  return sources;
}

// Resolve a relative import source to a repo-relative file path, or null when
// the target cannot be found (bare specifiers and CSS/assets return null).
function resolveImport(repoRoot, fromFile, source) {
  if (!source.startsWith('.')) return null;
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), source));
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    base.endsWith('.js') ? `${base.slice(0, -3)}.ts` : null,
    base.endsWith('.js') ? `${base.slice(0, -3)}.tsx` : null,
    `${base}/index.ts`,
    `${base}/index.tsx`,
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (
      existsSync(path.join(repoRoot, candidate)) &&
      statSync(path.join(repoRoot, candidate)).isFile()
    ) {
      return candidate;
    }
  }
  return null;
}

// Import-graph ratchet rules skip colocated test files: tests may import any
// layer or store they verify.
function isNonTestSourceFile(relativePath) {
  return isSourceFile(relativePath) && !/\.(test|spec)\.(ts|tsx)$/.test(relativePath);
}

function serverLayerOf(relativePath) {
  if (!relativePath.startsWith('server/src/')) return null;
  const rest = relativePath.slice('server/src/'.length);
  if (!rest.includes('/')) return 'root';
  const top = rest.split('/')[0];
  if (top === '__tests__' || top === 'test' || top === 'test-helpers' || top === 'dev') return null;
  return SERVER_LAYER_ORDER.includes(top) ? top : null;
}

function assertServerLayerBoundaries(repoRoot, failures, options) {
  const allowlist =
    options.serverLayerViolationAllowlist ?? DEFAULT_SERVER_LAYER_VIOLATION_ALLOWLIST;

  for (const relativePath of walk(repoRoot, 'server/src', isNonTestSourceFile)) {
    const importerLayer = serverLayerOf(relativePath);
    if (!importerLayer) continue;

    const content = read(repoRoot, relativePath);
    for (const source of extractImportSources(content)) {
      const target = resolveImport(repoRoot, relativePath, source);
      if (!target) continue;
      const targetLayer = serverLayerOf(target);
      if (!targetLayer) continue;

      const importerIndex = SERVER_LAYER_ORDER.indexOf(importerLayer);
      const targetIndex = SERVER_LAYER_ORDER.indexOf(targetLayer);
      if (importerIndex >= targetIndex) continue;

      const key = `${relativePath} -> ${target}`;
      if (allowlist.has(key)) continue;
      failures.push(
        `${relativePath}: ${key} — server layer violation ${importerLayer} -> ${targetLayer}` +
          ' (see SERVER_LAYER_VIOLATION_ALLOWLIST in scripts/dev/check-architecture-boundaries.mjs)'
      );
    }
  }
}

// Store modules follow the `*Store.ts` naming convention; helper/type modules
// in stores/ (e.g. selectionTypes.ts) are the sanctioned sharing point.
function isStoreModule(relativePath) {
  return /Store\.tsx?$/.test(relativePath);
}

function assertDesktopStoreImportBoundaries(repoRoot, failures, options) {
  const allowlist = options.desktopStoreImportAllowlist ?? DEFAULT_DESKTOP_STORE_IMPORT_ALLOWLIST;

  for (const relativePath of walk(
    repoRoot,
    'apps/desktop/src/stores',
    p => isNonTestSourceFile(p) && isStoreModule(p)
  )) {
    const content = read(repoRoot, relativePath);
    for (const source of extractImportSources(content)) {
      const target = resolveImport(repoRoot, relativePath, source);
      if (!target || target === relativePath) continue;
      if (!target.startsWith('apps/desktop/src/stores/')) continue;
      if (!isStoreModule(target)) continue;

      const key = `${relativePath} -> ${target}`;
      if (allowlist.has(key)) continue;
      failures.push(
        `${relativePath}: ${key} — store-to-store import; coordinate stores in a service or share types via a types module` +
          ' (see DESKTOP_STORE_IMPORT_ALLOWLIST in scripts/dev/check-architecture-boundaries.mjs)'
      );
    }
  }
}

const DESKTOP_FEATURE_FILE_PATTERN = /^apps\/desktop\/src\/features\/([^/]+)\//;
const DESKTOP_FEATURE_TARGET_PATTERN = /^apps\/desktop\/src\/features\/([^/]+)\//;

// A feature's public surface: its curated index.ts, its HTTP api.ts, and
// <feature>-types.ts(x) contract files. Cross-feature imports may only
// target these; reaching into components/store/hooks of another feature is
// a violation.
function isFeaturePublicEntry(target) {
  const basename = path.posix.basename(target);
  return basename === 'index.ts' || basename === 'api.ts' || /-types\.tsx?$/.test(basename);
}

function assertDesktopFeatureImportBoundaries(repoRoot, failures, options) {
  const allowlist =
    options.desktopFeatureImportAllowlist ?? DEFAULT_DESKTOP_FEATURE_IMPORT_ALLOWLIST;

  for (const relativePath of walk(repoRoot, 'apps/desktop/src/features', isNonTestSourceFile)) {
    const ownFeature = relativePath.match(DESKTOP_FEATURE_FILE_PATTERN)?.[1];
    if (!ownFeature) continue; // files directly in features/ are composition points

    const content = read(repoRoot, relativePath);
    for (const source of extractImportSources(content)) {
      const target = resolveImport(repoRoot, relativePath, source);
      if (!target) continue;
      const targetFeature = target.match(DESKTOP_FEATURE_TARGET_PATTERN)?.[1];
      if (!targetFeature || targetFeature === ownFeature) continue;
      if (isFeaturePublicEntry(target)) continue;

      const key = `${relativePath} -> features/${targetFeature}`;
      if (allowlist.has(key)) continue;
      failures.push(
        `${relativePath}: ${key} — cross-feature import; depend on the feature's public entry` +
          ' (see DESKTOP_FEATURE_IMPORT_ALLOWLIST in scripts/dev/check-architecture-boundaries.mjs)'
      );
    }
  }
}

function assertDesktopServicesFeatureReexportBoundaries(repoRoot, failures, options) {
  const allowlist =
    options.desktopServicesReexportAllowlist ?? DEFAULT_DESKTOP_SERVICES_REEXPORT_ALLOWLIST;
  const reExportPattern =
    /export\s+(?:\*(?:\s+as\s+[\w$]+)?|\{[^}]*\})\s+from\s*['"](?<source>[^'"]+)['"]/g;

  for (const relativePath of walk(repoRoot, 'apps/desktop/src/services', isNonTestSourceFile)) {
    const content = read(repoRoot, relativePath);
    for (const match of content.matchAll(reExportPattern)) {
      const source = match.groups?.source;
      if (!source) continue;
      const target = resolveImport(repoRoot, relativePath, source);
      if (!target || !target.startsWith('apps/desktop/src/features/')) continue;

      const key = `${relativePath} -> ${target}`;
      if (allowlist.has(key)) continue;
      failures.push(
        `${relativePath}: ${key} — services re-export of a feature module; consumers should import the owning feature directly` +
          ' (see DESKTOP_SERVICES_REEXPORT_ALLOWLIST in scripts/dev/check-architecture-boundaries.mjs)'
      );
    }
  }
}

// desktop: utils/ must stay pure — no imports of stores, services, facades,
// features, actions or UI layers. Side-effectful action modules live in actions/.
const DESKTOP_UTILS_FORBIDDEN_TOP = [
  'stores',
  'services',
  'facade',
  'features',
  'actions',
  'components',
  'app',
  'contexts',
  'plugins',
];

function assertDesktopUtilsPurity(repoRoot, failures) {
  for (const relativePath of walk(repoRoot, 'apps/desktop/src/utils', isNonTestSourceFile)) {
    const content = read(repoRoot, relativePath);
    for (const source of extractImportSources(content)) {
      if (!source.startsWith('.')) continue;
      const target = resolveImport(repoRoot, relativePath, source);
      if (!target) continue;
      const rest = target.slice('apps/desktop/src/'.length);
      const top = rest.split('/')[0];
      if (DESKTOP_UTILS_FORBIDDEN_TOP.includes(top)) {
        failures.push(
          `${relativePath}: utils module imports ${top}/ (${target}); utils must stay pure — move side-effectful code to actions/ or services/`
        );
      }
    }
  }
}

function assertDesktopProviderMetaBoundaries(repoRoot, failures) {
  const desktopFiles = walk(
    repoRoot,
    'apps/desktop/src',
    relativePath => isSourceFile(relativePath) && !relativePath.endsWith('/stores/projectStore.ts')
  );

  const forbiddenPatterns = [
    {
      pattern: /useProjectStore\s*\(\s*\([^)]*\)\s*=>\s*[^)]*\.providerCommands\b/s,
      message: 'Do not read providerCommands from projectStore; use providerMetaStore instead.',
    },
    {
      pattern: /useProjectStore\s*\(\s*\([^)]*\)\s*=>\s*[^)]*\.providerCapabilities\b/s,
      message: 'Do not read providerCapabilities from projectStore; use providerMetaStore instead.',
    },
    {
      pattern: /useProjectStore\.getState\(\)\.providerCommands\b/,
      message:
        'Do not read providerCommands from projectStore.getState(); use providerMetaStore instead.',
    },
    {
      pattern: /useProjectStore\.getState\(\)\.providerCapabilities\b/,
      message:
        'Do not read providerCapabilities from projectStore.getState(); use providerMetaStore instead.',
    },
    {
      pattern: /useProjectStore\.getState\(\)\.setProviderCommands\b/,
      message: 'Do not write providerCommands through projectStore; use providerMetaStore instead.',
    },
    {
      pattern: /useProjectStore\.getState\(\)\.setProviderCapabilities\b/,
      message:
        'Do not write providerCapabilities through projectStore; use providerMetaStore instead.',
    },
  ];

  for (const relativePath of desktopFiles) {
    for (const { pattern, message } of forbiddenPatterns) {
      assertNoMatch(repoRoot, failures, relativePath, pattern, message);
    }
  }
}

function assertDesktopSelectionStoreBoundaries(repoRoot, failures, options) {
  const allowlist = new Set(
    options.desktopLegacyProjectStoreAllowlist ?? DEFAULT_DESKTOP_LEGACY_PROJECT_STORE_ALLOWLIST
  );
  const desktopFiles = walk(
    repoRoot,
    'apps/desktop/src',
    relativePath =>
      isSourceFile(relativePath) &&
      !relativePath.endsWith('/stores/projectStore.ts') &&
      !allowlist.has(relativePath)
  );
  const forbiddenPatterns = [
    {
      pattern: /useProjectStore\s*\(\s*\([^)]*\)\s*=>\s*[^)]*\.selectedProjectId\b/s,
      message: 'Do not read selectedProjectId from projectStore; use selectionStore instead.',
    },
    {
      pattern: /useProjectStore\s*\(\s*\([^)]*\)\s*=>\s*[^)]*\.selectedSessionId\b/s,
      message: 'Do not read selectedSessionId from projectStore; use selectionStore instead.',
    },
    {
      pattern: /useProjectStore\s*\(\s*\([^)]*\)\s*=>\s*[^)]*\.dashboardViews\b/s,
      message: 'Do not read dashboardViews from projectStore; use selectionStore instead.',
    },
    {
      pattern: /useProjectStore\.getState\(\)\.selectedProjectId\b/,
      message:
        'Do not read selectedProjectId from projectStore.getState(); use selectionStore instead.',
    },
    {
      pattern: /useProjectStore\.getState\(\)\.selectedSessionId\b/,
      message:
        'Do not read selectedSessionId from projectStore.getState(); use selectionStore instead.',
    },
    {
      pattern: /useProjectStore\.getState\(\)\.dashboardViews\b/,
      message:
        'Do not read dashboardViews from projectStore.getState(); use selectionStore instead.',
    },
  ];

  for (const relativePath of desktopFiles) {
    for (const { pattern, message } of forbiddenPatterns) {
      assertNoMatch(repoRoot, failures, relativePath, pattern, message);
    }
  }
}

function assertDesktopServicesApiBoundaries(repoRoot, failures, options) {
  const relativePath = 'apps/desktop/src/services/api.ts';
  if (!existsSync(path.join(repoRoot, relativePath))) return;

  const allowlist = new Set(
    options.desktopServicesFeatureApiReexportAllowlist ??
      DEFAULT_DESKTOP_SERVICES_FEATURE_API_REEXPORT_ALLOWLIST
  );
  const content = read(repoRoot, relativePath);
  const reExportPattern = /export\s+\*\s+from\s+['"](?<source>\.\.\/features\/[^'"]+)['"]/g;

  for (const match of content.matchAll(reExportPattern)) {
    const source = match.groups?.source;
    if (source && allowlist.has(source)) continue;
    failures.push(
      `${relativePath}: Do not re-export feature APIs from services/api; import feature APIs directly from the owning feature.`
    );
  }
}

function assertDesktopComponentFeatureImportBoundaries(repoRoot, failures, options) {
  const allowlist = new Set(
    options.desktopComponentFeatureImportAllowlist ??
      DEFAULT_DESKTOP_COMPONENT_FEATURE_IMPORT_ALLOWLIST
  );
  const componentFiles = walk(
    repoRoot,
    'apps/desktop/src/components',
    relativePath => isSourceFile(relativePath) && !allowlist.has(relativePath)
  );

  for (const relativePath of componentFiles) {
    assertNoMatch(
      repoRoot,
      failures,
      relativePath,
      /from\s+['"]\.[^'"]*features\//,
      'Do not import feature modules from shared components; move shared code to components, hooks, services, or utils.'
    );
  }
}

function isServerRouteLikeFile(relativePath) {
  if (!isSourceFile(relativePath)) return false;
  const basename = path.posix.basename(relativePath);

  if (relativePath.startsWith('server/src/domains/')) {
    return (
      basename === 'routes.ts' || basename.endsWith('-routes.ts') || basename === 'register.ts'
    );
  }

  return relativePath.startsWith('server/src/application/conversation/handlers/');
}

function assertServerRouteLikeFilesNoRawSql(repoRoot, failures) {
  const routeFiles = [
    ...walk(repoRoot, 'server/src/domains', isServerRouteLikeFile),
    ...walk(repoRoot, 'server/src/application/conversation/handlers', isServerRouteLikeFile),
  ];
  const forbiddenPatterns = [
    {
      pattern: /\.\s*prepare\s*\(/,
      message:
        'Do not issue raw SQL in domain route/register/handler files; move persistence to repository or service.',
    },
    {
      pattern: /\.\s*transaction\s*\(/,
      message:
        'Do not issue DB transactions in domain route/register/handler files; move persistence to repository or service.',
    },
  ];

  for (const relativePath of routeFiles) {
    for (const { pattern, message } of forbiddenPatterns) {
      assertNoMatch(repoRoot, failures, relativePath, pattern, message);
    }
  }
}

export function runArchitectureChecks(repoRoot = process.cwd(), options = {}) {
  const failures = [];
  assertServerRouteLikeFilesNoRawSql(repoRoot, failures);
  assertServerLayerBoundaries(repoRoot, failures, options);
  assertDesktopUtilsPurity(repoRoot, failures);
  assertDesktopProviderMetaBoundaries(repoRoot, failures);
  assertDesktopSelectionStoreBoundaries(repoRoot, failures, options);
  assertDesktopServicesApiBoundaries(repoRoot, failures, options);
  assertDesktopServicesFeatureReexportBoundaries(repoRoot, failures, options);
  assertDesktopStoreImportBoundaries(repoRoot, failures, options);
  assertDesktopFeatureImportBoundaries(repoRoot, failures, options);
  assertDesktopComponentFeatureImportBoundaries(repoRoot, failures, options);
  return failures;
}

function parseBaselineKeys(failures) {
  // New ratchet rules format messages as `<path>: <key> — <human message>`;
  // the baseline entry is everything between ': ' and the first ' —'.
  const keys = new Set();
  for (const failure of failures) {
    const body = failure.slice(failure.indexOf(': ') + 2);
    const [key] = body.split(' — ');
    if (key?.includes(' -> ')) keys.add(key);
  }
  return keys;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const reportMode = process.argv.includes('--report');
  const failures = runArchitectureChecks(
    process.cwd(),
    reportMode
      ? {
          serverLayerViolationAllowlist: new Set(),
          desktopStoreImportAllowlist: new Set(),
          desktopFeatureImportAllowlist: new Set(),
          desktopServicesReexportAllowlist: new Set(),
        }
      : {}
  );

  if (reportMode) {
    for (const key of [...parseBaselineKeys(failures)].sort()) {
      console.log(`  '${key}',`);
    }
    process.exit(0);
  }

  if (failures.length > 0) {
    console.error('Architecture boundary checks failed:\n');
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log('Architecture boundary checks passed.');
}
