# Plugin Package Installation

ZClaudia installs release plugins from `.zplugin` files while retaining directory loading as a
separate development workflow. A `.zplugin` is a ZIP whose root is the plugin root and contains a
root-level `plugin.json`.

## User flow

1. Open **Plugins** and choose **Install plugin**.
2. Select a `.zplugin` file.
3. Review the validated manifest, checksum, requested permissions, host CLI status, and warnings.
4. Confirm installation. The version is selected but remains inactive.
5. Enable the plugin from its card when ready.

Managed plugin details expose retained versions, rollback, reinstall/update from another local
package, and uninstall. Development plugins expose their source directory and directory settings;
ZClaudia does not delete development source trees.

## Storage layout

Only the selected version is visible to the existing directory loader:

```text
$ZCLAUDIA_DATA_DIR/
├── plugins/
│   └── <plugin-id>/                 # selected version, discovered by PluginLoader
├── plugin-store/
│   └── <plugin-id>/
│       ├── install-state.json       # selected version and immutable version records
│       ├── 1.0.0/
│       └── 1.1.0/
├── plugin-staging/                  # short-lived validated previews
└── plugin-uploads/                  # upload files, removed after inspection
```

Version selection copies a retained version into a pending directory, deactivates and removes the
currently loaded instance, swaps the directory, and asks the loader to rediscover it. If the swap
or rediscovery fails, the previous selected directory is restored. Multiple retained versions are
never placed below `plugins/`, because the loader recursively discovers manifests and would treat
them as duplicate plugins.

## Validation boundary

Inspection does not import or execute plugin code. Before extraction, the host verifies:

- ZIP structure, CRC values, local/central-header agreement, and non-overlapping entries;
- archive, entry, expanded-size, and file-count limits;
- absolute paths, path traversal, unsafe or missing symlink targets, and special file types;
- the `plugin.json` schema, host compatibility range, and declared entrypoints;
- package/manifest version agreement and absence of `workspace:` dependencies;
- absence of development directories, environment files, likely key files, and runtime imports of
  the host-internal `@zclaudia/shared` package.

SHA-256 is recorded with each installed version. It detects corruption and conflicting artifacts
for the same version, but does not authenticate a publisher by itself. Catalog publisher pinning,
signed metadata/provenance, URL installation, and unattended updates remain separate follow-up
work and are required before background updates are enabled.

## Local package API

Package-mutating endpoints require an authenticated localhost request:

```text
POST   /api/plugins/packages/inspect       multipart field: package
POST   /api/plugins/packages/install       { "token": "<preview-token>" }
POST   /api/plugins/:id/rollback           { "version": "1.0.0" } (version optional)
DELETE /api/plugins/:id                    managed uninstall
```

An inspection token points to a validated staging directory and expires after 15 minutes. Install,
rollback, and uninstall mutations are serialized. `GET /api/plugins` adds managed/development
source, timestamps, retained versions, rollback availability, and executable requirement status to
the existing runtime state.
