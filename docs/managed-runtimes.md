# Managed Agent CLI Runtimes

ZClaudia can resolve and install a verified Agent CLI for one plugin without changing the user's
global CLI. Managed runtimes are host-owned: plugins declare static compatibility and artifact
metadata, while the trusted server performs selection, approval, download, verification,
extraction, probing, reference tracking, and cleanup.

## Resolution order

For a plugin that ships `runtime-compatibility.json`, the host resolves the executable immediately
before each Agent run:

1. The profile's explicit `cliPath`.
2. A managed version explicitly pinned for that plugin version.
3. A compatible system executable found on `PATH`.
4. Any compatible managed installation already present in the shared store.
5. A verified managed artifact selected according to policy.

An explicit path is authoritative. If it is missing, too old, known-incompatible, or fails its
probe, the run is blocked instead of silently switching to a different executable. A system CLI
that is incompatible is skipped so an installed or downloadable managed CLI can be offered.
A version newer than `testedMaximum` remains usable with a warning and can be tested from Settings;
ZClaudia never automatically downgrades it.

Plugins without `runtime-compatibility.json` retain the legacy behavior. Their adapter receives the
profile's original optional `cliPath`.

## User settings and approval

Open **Settings → Agents → Managed Agent CLIs** to select a policy:

- `system-only` disables managed downloads.
- `managed-ask` asks before downloading and is the default.
- `managed-auto` downloads only metadata from a trusted catalog or a trusted publisher whose
  identity was authenticated by a host catalog/package source. A self-declared
  `plugin.json` author name never grants auto-install trust. Untrusted plugin metadata still
  requires explicit review.

The review shows the source URL, expected size when declared, SHA-256 digest, version, and trust
state. After installation the status shows the selected source, authentication result, checksum
state, observed size, and store path. Installed versions can be pinned, unpinned, tested, or rolled
back.

A headless caller cannot display the review. Under `managed-ask`, resolution returns
`needs-approval` and does not download anything.

## Storage, references, and cleanup

The default data directory is `~/.zclaudia` (or `ZCLAUDIA_DATA_DIR` when configured):

```text
runtime-store/<runtime>/<version>/<platform-arch>/
runtime-refs/<plugin-id>/<plugin-version>.json
runtime-staging/
runtime-locks/
managed-runtime-settings.json
```

The store is content-verified but keyed by runtime, version, and platform so multiple plugins
reuse one installed CLI. Per-artifact lock files serialize concurrent installs. Downloads,
extraction, version checks, compatibility probes, authentication probes, and metadata writes occur
in a same-filesystem staging directory before an atomic rename. A failed install removes staging
data and leaves the previous selection and installation intact.

Reference files record all versions used by one plugin version, its optional pin, and bounded
selection history. Plugin package removal releases its reference. Garbage collection removes only
unreferenced platform installations older than the grace period (seven days by default); the UI
does not delete an installation still referenced by another plugin.

## Authentication and configuration

Managed runtime isolation applies to the executable, not the user's identity:

- ZClaudia changes only the resolved executable path passed to the adapter.
- The child receives the normal `HOME`, OS Keychain access, and inherited official provider
  environment variables.
- Provider config and auth locations are not redirected into `runtime-store`.
- ZClaudia does not read, copy, export, upload, convert, or rewrite authentication tokens.

After installation the declared `authProbe` runs with that inherited environment. If an older CLI
cannot read the user's current official authentication format, resolution returns `auth-required`.
The user must use that CLI's official login flow. Authentication compatibility is not inferred from
the artifact checksum.

## Download and extraction security

`url`, version, platform, architecture, mandatory SHA-256, archive format, and archive executable
path must come from validated static metadata in a plugin package or trusted catalog. The host does
not contain provider-specific download URLs. If no platform artifact with a verified digest is
available, it returns `managed-artifact-unavailable`.

The installer:

- accepts HTTPS, or HTTP(S) origins explicitly configured as enterprise mirrors;
- validates every redirect and rejects URL credentials;
- streams into a bounded temporary file while enforcing declared and absolute size limits;
- requires the downloaded SHA-256 to match;
- verifies an optional Ed25519 detached signature and optional hashed provenance document;
- rejects ZIP/TAR absolute paths, `..`, backslash traversal, duplicate entries, dangerous links,
  unsupported TAR types, too many files, oversized members, and excessive expanded size;
- requires the declared executable to be a regular non-symlink file;
- executes only the extracted CLI's declared version, compatibility, and auth probes.

Installer scripts are never executed. Metadata must describe `raw`, `zip`, or `tar.gz` bytes; a
`curl | sh`-style flow is not supported.

## Enterprise policy

Deployments can seed trust and mirrors with comma-separated environment variables:

```text
ZCLAUDIA_TRUSTED_RUNTIME_PUBLISHERS=Example Corp,Corporate Engineering
ZCLAUDIA_RUNTIME_MIRROR_ORIGINS=https://artifacts.corp.example,http://mirror.internal:8080
```

An origin must match exactly, including scheme and port. These environment values are merged with
persisted settings and cannot be removed through the current UI. Network egress controls,
certificate policy, artifact catalog governance, and approval of publisher identity remain the
operator's responsibility.

## Plugin contract

The optional, schema-version-1 `managedInstall` field is additive:

```json
{
  "managedInstall": {
    "recommendedVersion": "1.2.3",
    "authProbe": {
      "args": ["auth", "status"],
      "successExitCodes": [0],
      "unauthenticatedPattern": "login required"
    },
    "versions": [
      {
        "version": "1.2.3",
        "artifacts": {
          "linux-x64": {
            "url": "https://artifacts.example.invalid/agent-1.2.3-linux-x64.tar.gz",
            "sha256": "0000000000000000000000000000000000000000000000000000000000000000",
            "archiveFormat": "tar.gz",
            "executablePath": "bin/agent",
            "size": 123456
          }
        }
      }
    ]
  }
}
```

Supported keys are `darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64`, and `win32-x64`.
`authProbe` may be declared globally or overridden for one version. Artifacts may additionally
declare Ed25519 `signature` and hashed `provenance` metadata.

The example uses a non-resolving domain and placeholder digest. Real metadata must be derived from
an authoritative provider release or a governed enterprise catalog; never guess a URL or checksum.

Plugins with `provider.register` receive a restricted API:

```ts
const resolution = await context.managedRuntimes?.resolve({
  runtime: 'example',
  explicitPath: configuredCliPath,
  headless: true,
});
```

The host binds the call to the current plugin ID. The plugin cannot pass download metadata or
approve its own download. The Agent adapter continues to receive only the final resolved `cliPath`
and never downloads an executable itself.

## Release canary

Run a real download, checksum, extraction, compatibility, authentication, pin, and second-resolution
canary without calling a model:

```bash
pnpm canary:managed-runtime -- \
  --plugin-package /absolute/path/to/zclaudia-agent-codex-0.1.0-any.zplugin
```

This form first installs the packaged plugin into the isolated data directory, then validates its
managed runtime. During development, `--plugin-dir /absolute/plugin/directory` can be used instead.
The command removes the temporary plugin and runtime stores when it finishes and deliberately hides
the system CLI from resolution. It still inherits the normal home directory, keychain, and provider
environment so the authentication probe verifies reuse of the existing login. Pass `--keep-data`
only when the retained store is needed for diagnosis.

Managed store metadata is protected against untrusted paths and digest collisions, but it is not a
privilege boundary against another process running as the same OS user. Operate only one ZClaudia
server per data directory and protect that account and directory permissions. A verified detached
signature proves only that the artifact matches the public key in authenticated metadata; it does
not independently establish publisher identity for a manually installed, self-signed plugin.
