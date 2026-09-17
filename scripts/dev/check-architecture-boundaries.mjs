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
  'server/src/application/bootstrap/feature-domains.ts -> server/src/interfaces/http/llm-profile-oauth.ts',
  'server/src/application/bootstrap/platform-routes.ts -> server/src/interfaces/http/debug.ts',
  'server/src/application/bootstrap/platform-routes.ts -> server/src/interfaces/http/gateway.ts',
  'server/src/application/bootstrap/platform-routes.ts -> server/src/interfaces/http/mcp-servers.ts',
  'server/src/application/bootstrap/platform-routes.ts -> server/src/interfaces/http/system-stats.ts',
  'server/src/application/bootstrap/platform-routes.ts -> server/src/interfaces/http/system-tasks.ts',
  'server/src/application/bootstrap/platform-routes.ts -> server/src/interfaces/http/usage-stats.ts',
  'server/src/application/bootstrap/platform-routes.ts -> server/src/interfaces/http/web-search.ts',
  'server/src/application/bootstrap/platform-routes.ts -> server/src/interfaces/http/workspace.ts',
  'server/src/application/bootstrap/platform-routes.ts -> server/src/interfaces/mcp/mcp-server.ts',
  'server/src/application/conversation/handlers/terminal.ts -> server/src/terminal-manager.ts',
  'server/src/application/conversation/runtime/run-reducer.ts -> server/src/loop-detection.ts',
  'server/src/application/conversation/transport/broadcast.ts -> server/src/loop-detection.ts',
  'server/src/application/conversation/transport/message-handler.ts -> server/src/terminal-manager.ts',
  'server/src/application/domain-bootstrap.ts -> server/src/interfaces/http/agent.ts',
  'server/src/application/domain-bootstrap.ts -> server/src/interfaces/http/claudia.ts',
  'server/src/application/domain-bootstrap.ts -> server/src/interfaces/http/commands.ts',
  'server/src/application/domain-bootstrap.ts -> server/src/interfaces/http/delegation.ts',
  'server/src/application/domain-bootstrap.ts -> server/src/interfaces/http/files.ts',
  'server/src/application/domain-bootstrap.ts -> server/src/interfaces/http/middleware/local-only.ts',
  'server/src/application/domain-bootstrap.ts -> server/src/server-setup.ts',
  'server/src/application/domain-bootstrap.ts -> server/src/server-state.ts',
  'server/src/application/plugins/routes.ts -> server/src/interfaces/http/response.ts',
  'server/src/application/plugins/tools-routes.ts -> server/src/interfaces/http/response.ts',
  'server/src/domains/agent-profiles/register.ts -> server/src/application/managed-runtimes/routes.ts',
  'server/src/domains/agent-profiles/runtime-descriptors-routes.ts -> server/src/application/plugins/loader.ts',
  'server/src/domains/attachments/routes.ts -> server/src/interfaces/http/response.ts',
  'server/src/domains/automations/register.ts -> server/src/interfaces/http/automations.ts',
  'server/src/domains/goals/ports/continue-turn-port.ts -> server/src/application/conversation/transport/types.ts',
  'server/src/domains/goals/routes.ts -> server/src/interfaces/http/response.ts',
  'server/src/domains/llm-profiles/routes.ts -> server/src/application/conversation/compaction/context-windows.ts',
  'server/src/domains/projects/routes.ts -> server/src/interfaces/http/response.ts',
  'server/src/domains/sessions/drafts-routes.ts -> server/src/interfaces/http/response.ts',
  'server/src/domains/sessions/message-routes.ts -> server/src/application/conversation/runtime/active-run-phase.ts',
  'server/src/domains/sessions/model-settings-service.ts -> server/src/application/managed-runtimes/service.ts',
  'server/src/domains/sessions/register.ts -> server/src/application/invocations/session-catalog.ts',
  'server/src/domains/sessions/register.ts -> server/src/interfaces/http/session-invocables.ts',
  'server/src/domains/sessions/routes.ts -> server/src/application/conversation/title/request-session-title.ts',
  'server/src/domains/sessions/routes.ts -> server/src/application/conversation/transport/types.ts',
  'server/src/domains/sessions/routes.ts -> server/src/interfaces/http/provider-capabilities.ts',
  'server/src/domains/sessions/routes.ts -> server/src/interfaces/http/response.ts',
  'server/src/domains/tasks/executors/agent-executor.ts -> server/src/application/orchestration/agent-task-runner.ts',
  'server/src/domains/workflows/step-executors/workflow-agent-permissions.ts -> server/src/application/conversation/agent/permission-evaluator.ts',
  'server/src/domains/workflows/step-executors/workflow-agent-runtime-resolver.ts -> server/src/application/conversation/context/engine.ts',
  'server/src/domains/workflows/step-executors/workflow-agent-runtime-resolver.ts -> server/src/application/conversation/context/memory-context.ts',
  'server/src/domains/workflows/step-executors/workflow-agent-runtime-resolver.ts -> server/src/application/conversation/runtime/resolve-user-hooks.ts',
  'server/src/domains/workflows/step-executors/workflow-agent-runtime-resolver.ts -> server/src/application/plugins/index.ts',
  'server/src/domains/workflows/step-executors/workflow-agent-runtime-resolver.ts -> server/src/application/services/workspace.ts',
  'server/src/infra/gateway/gateway-backend-data-publisher.ts -> server/src/application/conversation/transport/types.ts',
  'server/src/infra/gateway/gateway-channel-cleanup.ts -> server/src/application/conversation/runtime/active-run-phase.ts',
  'server/src/infra/gateway/gateway-channel-cleanup.ts -> server/src/application/conversation/transport/types.ts',
  'server/src/infra/gateway/gateway-client.ts -> server/src/application/conversation/transport/types.ts',
  'server/src/infra/gateway/gateway-state.ts -> server/src/interfaces/http/gateway.ts',
  'server/src/infra/gateway/manager.ts -> server/src/application/conversation/transport/types.ts',
  'server/src/infra/gateway/manager.ts -> server/src/interfaces/http/gateway.ts',
  'server/src/infra/gateway/manager.ts -> server/src/server.ts',
  'server/src/infra/providers/initializer.ts -> server/src/application/services/system-task-registry.ts',
  'server/src/infra/providers/pi-agent/adapter.ts -> server/src/application/conversation/compaction/context-estimate.ts',
  'server/src/infra/providers/pi-agent/adapter.ts -> server/src/application/conversation/compaction/context-windows.ts',
  'server/src/infra/providers/pi-agent/adapter.ts -> server/src/application/conversation/runtime/resolve-image-attachments.ts',
  'server/src/infra/providers/pi-runtime/agent-loop/lightweight-agent-runner.ts -> server/src/domains/agent-loop/index.ts',
  'server/src/infra/providers/pi-runtime/agent-loop/lightweight-agent-runner.ts -> server/src/domains/llm-profiles/repository.ts',
  'server/src/infra/providers/pi-runtime/agent-loop/toolsets.ts -> server/src/domains/agent-loop/index.ts',
  'server/src/infra/providers/pi-runtime/agent-stream.ts -> server/src/domains/llm-profiles/codex-oauth-errors.ts',
  'server/src/infra/providers/pi-runtime/bash-tool.ts -> server/src/application/conversation/agent/permission-memory.ts',
  'server/src/infra/providers/pi-runtime/bash-tool.ts -> server/src/domains/tasks/executors/command-executor.ts',
  'server/src/infra/providers/pi-runtime/bash-tool.ts -> server/src/domains/tasks/repository.ts',
  'server/src/infra/providers/pi-runtime/bash-tool.ts -> server/src/domains/tasks/task-service.ts',
  'server/src/infra/providers/pi-runtime/build-model.ts -> server/src/domains/llm-profiles/codex-oauth-service.ts',
  'server/src/infra/providers/pi-runtime/build-model.ts -> server/src/domains/llm-profiles/repository-registry.ts',
  'server/src/infra/providers/pi-runtime/command-task-runtime.ts -> server/src/domains/tasks/executors/command-executor.ts',
  'server/src/infra/providers/pi-runtime/command-task-runtime.ts -> server/src/domains/tasks/repository.ts',
  'server/src/infra/providers/pi-runtime/command-task-runtime.ts -> server/src/domains/tasks/task-service.ts',
  'server/src/infra/providers/pi-runtime/eval-task-runtime.ts -> server/src/domains/tasks/executors/command-executor.ts',
  'server/src/infra/providers/pi-runtime/eval-task-runtime.ts -> server/src/domains/tasks/executors/types.ts',
  'server/src/infra/providers/pi-runtime/eval-task-runtime.ts -> server/src/domains/tasks/repository.ts',
  'server/src/infra/providers/pi-runtime/eval-task-runtime.ts -> server/src/domains/tasks/task-service.ts',
  'server/src/infra/providers/pi-runtime/eval-tool.ts -> server/src/application/conversation/agent/permission-memory.ts',
  'server/src/infra/providers/pi-runtime/eval-tool.ts -> server/src/domains/tasks/repository.ts',
  'server/src/infra/providers/pi-runtime/eval-tool.ts -> server/src/domains/tasks/task-service.ts',
  'server/src/infra/providers/pi-runtime/external-tools.ts -> server/src/domains/tasks/executors/command-executor.ts',
  'server/src/infra/providers/pi-runtime/interaction-tools.ts -> server/src/application/conversation/interactions/todo-normalizer.ts',
  'server/src/infra/providers/pi-runtime/mode-tools.ts -> server/src/application/conversation/interactions/interaction-dispatcher.ts',
  'server/src/infra/providers/pi-runtime/mode-tools.ts -> server/src/domains/sessions/plan-mode-toggle.ts',
  'server/src/infra/providers/pi-runtime/mode-tools.ts -> server/src/domains/sessions/repository.ts',
  'server/src/infra/providers/pi-runtime/models-registry.ts -> server/src/domains/llm-profiles/codex-oauth-pi.ts',
  'server/src/infra/providers/pi-runtime/models-registry.ts -> server/src/domains/llm-profiles/repository-registry.ts',
  'server/src/infra/providers/pi-runtime/run-tools.ts -> server/src/application/conversation/agent/permission-memory.ts',
  'server/src/infra/providers/pi-runtime/skills.ts -> server/src/application/plugins/skill-tools.ts',
  'server/src/infra/providers/pi-runtime/task-runtime.ts -> server/src/domains/tasks/executors/types.ts',
  'server/src/infra/providers/pi-runtime/task-tools.ts -> server/src/domains/tasks/executors/types.ts',
  'server/src/infra/providers/pi-runtime/task-tools.ts -> server/src/domains/tasks/repository.ts',
  'server/src/infra/providers/pi-runtime/task-tools.ts -> server/src/domains/tasks/task-service.ts',
  'server/src/infra/providers/pi-runtime/tool-failure-loop-guard.ts -> server/src/loop-detection.ts',
  'server/src/infra/providers/pi-runtime/tool-options.ts -> server/src/domains/tasks/executors/types.ts',
  'server/src/infra/providers/pi-runtime/tool-result-store.ts -> server/src/domains/tasks/executors/command-executor.ts',
  'server/src/infra/providers/pi-runtime/web-tools.ts -> server/src/domains/web-search/config.ts',
  'server/src/infra/providers/runtime-routes.ts -> server/src/interfaces/http/provider-capabilities.ts',
  'server/src/infra/providers/runtime-routes.ts -> server/src/interfaces/http/provider-commands.ts',
  'server/src/infra/providers/types.ts -> server/src/domains/tasks/executors/types.ts',
  'server/src/infra/storage/db.ts -> server/src/domains/agent-profiles/ensure-default-agent-profile.ts',
  'server/src/infra/storage/fileStore.ts -> server/src/application/services/system-task-registry.ts',
  'server/src/utils/command-scanner.ts -> server/src/application/plugins/command-templates-loader.ts',
  'server/src/utils/command-scanner.ts -> server/src/infra/execution-env.ts',
  'server/src/utils/mcp-bridge-launch.ts -> server/src/application/plugins/tool-registry.ts',
  'server/src/utils/mcp-config.ts -> server/src/infra/services/mcp-oauth-credential-protector.ts',
  'server/src/utils/mcp-remote-client.ts -> server/src/domains/mcp/mcp-oauth-discovery.ts',
  'server/src/utils/memory-paths.ts -> server/src/domains/tasks/executors/command-executor.ts',
  'server/src/utils/run-state.ts -> server/src/application/conversation/runtime/active-run-phase.ts',
  'server/src/utils/server-utils.ts -> server/src/infra/providers/types.ts',
]);

// desktop: a store file may not import another store file (cross-store
// coordination belongs in services/consumers, shared types in a types module).
const DEFAULT_DESKTOP_STORE_IMPORT_ALLOWLIST = new Set([
  'apps/desktop/src/stores/chatMessageStore.ts -> apps/desktop/src/stores/runStore.ts',
  'apps/desktop/src/stores/draftEditorStore.ts -> apps/desktop/src/stores/pluginStore.ts',
  'apps/desktop/src/stores/fileViewerStore.ts -> apps/desktop/src/stores/pluginStore.ts',
  'apps/desktop/src/stores/llmProfileMetaStore.ts -> apps/desktop/src/stores/serverStore.ts',
  'apps/desktop/src/stores/projectStore.ts -> apps/desktop/src/stores/gatewayStore.ts',
  'apps/desktop/src/stores/projectStore.ts -> apps/desktop/src/stores/llmProfileMetaStore.ts',
  'apps/desktop/src/stores/projectStore.ts -> apps/desktop/src/stores/ownershipStore.ts',
  'apps/desktop/src/stores/projectStore.ts -> apps/desktop/src/stores/rightWorkspaceStore.ts',
  'apps/desktop/src/stores/projectStore.ts -> apps/desktop/src/stores/runStore.ts',
  'apps/desktop/src/stores/projectStore.ts -> apps/desktop/src/stores/selectionStore.ts',
  'apps/desktop/src/stores/projectStore.ts -> apps/desktop/src/stores/serverStore.ts',
  'apps/desktop/src/stores/rightWorkspaceStore.ts -> apps/desktop/src/stores/panelInstance.ts',
  'apps/desktop/src/stores/runStore.ts -> apps/desktop/src/stores/chatMessageStore.ts',
  'apps/desktop/src/stores/runStore.ts -> apps/desktop/src/stores/sessionConfigStore.ts',
  'apps/desktop/src/stores/runtimeDescriptorStore.ts -> apps/desktop/src/stores/serverStore.ts',
  'apps/desktop/src/stores/sessionRunStateStore.ts -> apps/desktop/src/stores/interactionStore.ts',
  'apps/desktop/src/stores/sessionRunStateStore.ts -> apps/desktop/src/stores/ownershipStore.ts',
  'apps/desktop/src/stores/sessionRunStateStore.ts -> apps/desktop/src/stores/permissionStore.ts',
  'apps/desktop/src/stores/sessionRunStateStore.ts -> apps/desktop/src/stores/projectStore.ts',
  'apps/desktop/src/stores/sessionRunStateStore.ts -> apps/desktop/src/stores/promptRequestStore.ts',
  'apps/desktop/src/stores/sessionRunStateStore.ts -> apps/desktop/src/stores/runStore.ts',
  'apps/desktop/src/stores/sessionRunStateStore.ts -> apps/desktop/src/stores/sessionsStore.ts',
  'apps/desktop/src/stores/sessionsStore.ts -> apps/desktop/src/stores/ownershipStore.ts',
  'apps/desktop/src/stores/sessionsStore.ts -> apps/desktop/src/stores/rightWorkspaceStore.ts',
  'apps/desktop/src/stores/terminalStore.ts -> apps/desktop/src/stores/pluginStore.ts',
  'apps/desktop/src/stores/terminalStore.ts -> apps/desktop/src/stores/serverStore.ts',
]);

// desktop: a file inside features/<name>/ may not import features/<other>/.
const DEFAULT_DESKTOP_FEATURE_IMPORT_ALLOWLIST = new Set([
  'apps/desktop/src/features/agent/readiness-copy.ts -> features/agents',
  'apps/desktop/src/features/automation/AutomationScope.tsx -> features/agents',
  'apps/desktop/src/features/automation/AutomationWorkflowDetail.tsx -> features/workflows',
  'apps/desktop/src/features/automation/RunsTab.tsx -> features/workflows',
  'apps/desktop/src/features/automation/useAutomationByBackend.ts -> features/agents',
  'apps/desktop/src/features/changes/SummarySection.tsx -> features/local-issues',
  'apps/desktop/src/features/chat/ChatInterface.tsx -> features/supervision',
  'apps/desktop/src/features/chat/EmptySessionOverview.tsx -> features/git',
  'apps/desktop/src/features/chat/InteractionItem.tsx -> features/local-issues',
  'apps/desktop/src/features/chat/MessageInput.tsx -> features/attachments',
  'apps/desktop/src/features/chat/MessageList.tsx -> features/browser',
  'apps/desktop/src/features/chat/SessionChatLayout.tsx -> features/git',
  'apps/desktop/src/features/claudia/ClaudiaChat.tsx -> features/chat',
  'apps/desktop/src/features/dashboard/DashboardHome.tsx -> features/git',
  'apps/desktop/src/features/dashboard/DashboardHome.tsx -> features/local-issues',
  'apps/desktop/src/features/dashboard/DashboardHome.tsx -> features/local-pr',
  'apps/desktop/src/features/dashboard/DashboardHome.tsx -> features/supervision',
  'apps/desktop/src/features/dashboard/DashboardHome.tsx -> features/workflows',
  'apps/desktop/src/features/dashboard/ProjectDashboard.tsx -> features/automation',
  'apps/desktop/src/features/dashboard/ProjectDashboard.tsx -> features/chat',
  'apps/desktop/src/features/dashboard/ProjectDashboard.tsx -> features/git',
  'apps/desktop/src/features/dashboard/ProjectDashboard.tsx -> features/local-issues',
  'apps/desktop/src/features/dashboard/ProjectDashboard.tsx -> features/local-pr',
  'apps/desktop/src/features/dashboard/ProjectDashboard.tsx -> features/openspec',
  'apps/desktop/src/features/dashboard/ProjectDashboard.tsx -> features/supervision',
  'apps/desktop/src/features/local-issues/components/CreateIssueDialog.tsx -> features/attachments',
  'apps/desktop/src/features/local-issues/components/LocalIssueCard.tsx -> features/attachments',
  'apps/desktop/src/features/local-issues/components/LocalIssueDetailView.tsx -> features/attachments',
  'apps/desktop/src/features/local-issues/components/LocalIssuesPanel.tsx -> features/attachments',
  'apps/desktop/src/features/meta-workflow/components/MetaWorkflowPanel.tsx -> features/openspec',
  'apps/desktop/src/features/meta-workflow/components/PhaseDetailScreen.tsx -> features/workflows',
  'apps/desktop/src/features/permissions/AIReviewLogsWindow.tsx -> features/workflows',
  'apps/desktop/src/features/plugins/PluginsContent.tsx -> features/settings',
  'apps/desktop/src/features/settings/PermissionSettings.tsx -> features/workflows',
  'apps/desktop/src/features/settings/ProjectSettings.tsx -> features/workflows',
  'apps/desktop/src/features/sidebar/Sidebar.tsx -> features/agent',
  'apps/desktop/src/features/sidebar/Sidebar.tsx -> features/agents',
  'apps/desktop/src/features/sidebar/Sidebar.tsx -> features/automation',
  'apps/desktop/src/features/sidebar/Sidebar.tsx -> features/git',
  'apps/desktop/src/features/sidebar/Sidebar.tsx -> features/plugins',
  'apps/desktop/src/features/sidebar/Sidebar.tsx -> features/settings',
  'apps/desktop/src/features/sidebar/SidebarNav.tsx -> features/agents',
  'apps/desktop/src/features/sidebar/SidebarNav.tsx -> features/automation',
  'apps/desktop/src/features/sidebar/SidebarNav.tsx -> features/plugins',
  'apps/desktop/src/features/supervision/components/ActiveChangeCard.tsx -> features/openspec',
  'apps/desktop/src/features/supervision/components/SupervisorWorkspacePanel.tsx -> features/meta-workflow',
  'apps/desktop/src/features/supervision/components/SupervisorWorkspacePanel.tsx -> features/openspec',
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
    if (existsSync(path.join(repoRoot, candidate)) && statSync(path.join(repoRoot, candidate)).isFile()) {
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

function assertDesktopFeatureImportBoundaries(repoRoot, failures, options) {
  const allowlist = options.desktopFeatureImportAllowlist ?? DEFAULT_DESKTOP_FEATURE_IMPORT_ALLOWLIST;

  for (const relativePath of walk(repoRoot, 'apps/desktop/src/features', isNonTestSourceFile)) {
    const ownFeature = relativePath.match(DESKTOP_FEATURE_FILE_PATTERN)?.[1];
    if (!ownFeature) continue; // files directly in features/ are composition points

    const content = read(repoRoot, relativePath);
    for (const source of extractImportSources(content)) {
      const target = resolveImport(repoRoot, relativePath, source);
      if (!target) continue;
      const targetFeature = target.match(DESKTOP_FEATURE_TARGET_PATTERN)?.[1];
      if (!targetFeature || targetFeature === ownFeature) continue;

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
  const reExportPattern = /export\s+(?:\*(?:\s+as\s+[\w$]+)?|\{[^}]*\})\s+from\s*['"](?<source>[^'"]+)['"]/g;

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
      message: 'Do not write providerCapabilities through projectStore; use providerMetaStore instead.',
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
      message: 'Do not read dashboardViews from projectStore.getState(); use selectionStore instead.',
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
      /from\s+['"][^'"]*features\//,
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
