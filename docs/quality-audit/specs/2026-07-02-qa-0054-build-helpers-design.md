# QA-0054 — Extract two shared build-script helpers

Date: 2026-07-02
Finding: QA-0054 (platform build scripts large & duplicative). See `docs/quality-audit/findings.json`.

## Context

A prior pass already extracted `scripts/build/common.sh` (env/node/rustup/version/updates helpers)
adopted by `android.sh`, `macos.sh`, `linux.sh`. What remains of the three scripts is mostly
genuine platform-specific logic (Android manifest/gradle patching + keystore signing; macOS
keychain/p12 + DMG + re-signing + bundle verification; Linux deb/rpm) — not identical duplication.

Call-site analysis found only **two** remaining pieces of clean, byte-identical duplication worth
extracting. This spec covers exactly those two. The install/deps/build block was considered and
**rejected** — only `pnpm install` + `pnpm -r run build` are common; macOS/Linux additionally
bundle the server, Android has an `INSTALL_ONLY` gate + `VERSION` fallback and no server bundle, so
a shared helper would need flags and read less clearly than the inline code.

## Goal & success criteria

- Remove the two identified drift points by moving them into `common.sh`; scripts call the helpers.
- **Behaviour-preserving**: the emitted version strings and release-repo slugs are identical to
  today for every input (CI and local).
- **Verification constraint**: these scripts cannot be executed in this environment (no macOS/Android
  build, no `shellcheck`). Verification is `bash -n` (syntax) on all touched scripts + close code
  review. No behaviour change is the design's own guarantee, not a test's.

## Helper 1 — `zclaudia_tauri_semver`

`macos.sh` and `linux.sh` each contain the byte-identical line:
```bash
TAURI_VERSION="$(echo "$VERSION" | sed 's/^v//; s/-.*//')"
```
Add to `common.sh`:
```bash
# Strip a leading `v` and any prerelease suffix, yielding the strict MAJOR.MINOR.PATCH
# that Tauri's config requires. Usage: TAURI_VERSION="$(zclaudia_tauri_semver "$VERSION")"
zclaudia_tauri_semver() {
  echo "$1" | sed 's/^v//; s/-.*//'
}
```
Both scripts change their assignment to `TAURI_VERSION="$(zclaudia_tauri_semver "$VERSION")"`. The
surrounding `cat > tauri.<platform>.release.generated.json <<EOF` blocks differ per platform and
stay inline. `android.sh` is out of scope for this helper (it does not emit a Tauri semver config;
it derives `VERSION_CODE` separately).

## Helper 2 — `zclaudia_resolve_release_repo`

Both `android.sh` and `macos.sh` resolve the GitHub `owner/repo` slug using the identical extraction
`sed 's/.*github\.com[:/]\(.*\)\.git/\1/'`. Their wrappers differ slightly: android is a lazy
function that errors if the remote is missing; macOS is eager and prefers `GITHUB_REPOSITORY`
(the CI-provided repo) before falling back to the remote. Unify the core in `common.sh`:
```bash
# Resolve the GitHub `owner/repo` slug for release uploads: prefer the CI-provided
# GITHUB_REPOSITORY, else derive it from the named git remote (default: RELEASE_REMOTE or origin).
# Prints the slug (empty if it cannot be derived). Usage: repo="$(zclaudia_resolve_release_repo)"
zclaudia_resolve_release_repo() {
  local remote="${1:-${RELEASE_REMOTE:-origin}}"
  if [ -n "${GITHUB_REPOSITORY:-}" ]; then
    echo "$GITHUB_REPOSITORY"
    return 0
  fi
  git remote get-url "$remote" 2>/dev/null | sed 's/.*github\.com[:/]\(.*\)\.git/\1/'
}
```

Adoption, preserving each script's existing outer behaviour exactly:
- **macOS** (`macos.sh:242-251`): replace the inline `if [ -n "$GITHUB_REPOSITORY" ] … else … fi`
  block with `RELEASE_REPO="$(zclaudia_resolve_release_repo "$RELEASE_REMOTE")"`, keeping the
  following `echo "Release target: …"` line. Behaviour identical (helper already encodes the
  GITHUB_REPOSITORY-first fallback the macOS block used).
- **Android** (`android.sh:26-34`): keep the `resolve_release_repo()` wrapper name and its
  missing-remote error branch (that error message is Android-specific and is triggered before the
  slug is needed), but replace its final slug-extraction line with a call to
  `zclaudia_resolve_release_repo "$RELEASE_REMOTE"`. This keeps Android's stricter "remote must
  exist" precondition while sharing the extraction. Note: Android's wrapper does **not** consult
  `GITHUB_REPOSITORY` today; routing through the shared helper means Android will now also honor
  `GITHUB_REPOSITORY` when set — this is a strict improvement (correct CI target) and does not change
  local behaviour (where `GITHUB_REPOSITORY` is unset). Called out here so it is a conscious choice,
  not an accident.

## Out of scope

- The install/deps/build block (not clean duplication — see Context).
- Any signing / artifact-verification / manifest-generation logic (genuinely platform-specific).
- A TypeScript build orchestrator or a shared `sign_artifact`/`verify_bundle` abstraction (high
  risk, unverifiable here, low value given the platform divergence).

## Verification

- `bash -n scripts/build/common.sh scripts/build/android.sh scripts/build/macos.sh scripts/build/linux.sh` — all clean.
- Manual diff review confirming each adoption emits the same value as before for CI and local inputs.
- After landing, mark QA-0054 `fixed` in `findings.json` and close it in `PROGRESS.md`, recording
  that the remaining size is irreducible platform-specific logic.
