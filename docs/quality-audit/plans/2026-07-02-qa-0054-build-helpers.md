# QA-0054 Build-Helper Extraction Implementation Plan

> **For agentic workers:** small, behaviour-preserving shell refactor. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Move the two remaining byte-identical duplications out of the platform build scripts into `scripts/build/common.sh`, then close QA-0054.

**Architecture:** Two pure helpers in `common.sh` (`zclaudia_tauri_semver`, `zclaudia_resolve_release_repo`); `macos.sh`/`linux.sh`/`android.sh` call them. No behaviour change.

**Verification constraint:** scripts are not executable here (no macOS/Android build, no shellcheck). Gate = `bash -n` on every touched script + diff review. See spec `docs/quality-audit/specs/2026-07-02-qa-0054-build-helpers-design.md`.

## Global constraints

- Behaviour-preserving. Emitted version strings and repo slugs identical for CI and local inputs.
- `common.sh` is `source`d by the scripts (they already call `zclaudia_*` helpers), so new functions are available without extra wiring — confirm each script sources `common.sh` before first use.
- One commit per task.

---

### Task 1: Add `zclaudia_tauri_semver`; adopt in macos.sh + linux.sh

**Files:** Modify `scripts/build/common.sh`, `scripts/build/macos.sh`, `scripts/build/linux.sh`.

- [ ] **Step 1:** Append to `common.sh` (after `zclaudia_set_updates_enabled`):

```bash
# Strip a leading `v` and any prerelease suffix, yielding the strict MAJOR.MINOR.PATCH
# that Tauri's config requires. Usage: TAURI_VERSION="$(zclaudia_tauri_semver "$VERSION")"
zclaudia_tauri_semver() {
  echo "$1" | sed 's/^v//; s/-.*//'
}
```

- [ ] **Step 2:** In `macos.sh`, replace the line
  `TAURI_VERSION="$(echo "$VERSION" | sed 's/^v//; s/-.*//')"`
  with `TAURI_VERSION="$(zclaudia_tauri_semver "$VERSION")"` (keep the preceding comment).

- [ ] **Step 3:** In `linux.sh`, make the identical replacement.

- [ ] **Step 4:** `bash -n scripts/build/common.sh scripts/build/macos.sh scripts/build/linux.sh` — expect clean.

- [ ] **Step 5:** Commit:
```bash
git add scripts/build/common.sh scripts/build/macos.sh scripts/build/linux.sh
git commit -m "refactor(build): share zclaudia_tauri_semver across macos/linux (QA-0054)"
```

---

### Task 2: Add `zclaudia_resolve_release_repo`; adopt in macos.sh + android.sh

**Files:** Modify `scripts/build/common.sh`, `scripts/build/macos.sh`, `scripts/build/android.sh`.

- [ ] **Step 1:** Append to `common.sh`:

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

- [ ] **Step 2:** In `macos.sh` (the `RELEASE_REPO=…` block at ~242-251), replace the inline
  `if [ -n "${GITHUB_REPOSITORY:-}" ]; then RELEASE_REPO=… else RELEASE_REPO=$(git remote … sed …) … fi`
  with:
```bash
RELEASE_REPO="$(zclaudia_resolve_release_repo "$RELEASE_REMOTE")"
```
  Keep the surrounding `RELEASE_REMOTE="${RELEASE_REMOTE:-origin}"` line above and the
  `echo "Release target: ${GITHUB_REPOSITORY:-$RELEASE_REMOTE} → $RELEASE_REPO"` line below.

- [ ] **Step 3:** In `android.sh`, keep the `resolve_release_repo()` wrapper (name + its
  missing-remote error branch) but replace its final slug-extraction line
  `git remote get-url "$RELEASE_REMOTE" | sed 's/.*github\.com[:/]\(.*\)\.git/\1/'`
  with `zclaudia_resolve_release_repo "$RELEASE_REMOTE"`. (Documented consequence: Android now also
  honors `GITHUB_REPOSITORY` when set — a strict CI improvement; local behaviour unchanged.)

- [ ] **Step 4:** `bash -n scripts/build/common.sh scripts/build/macos.sh scripts/build/android.sh` — expect clean.

- [ ] **Step 5:** Commit:
```bash
git add scripts/build/common.sh scripts/build/macos.sh scripts/build/android.sh
git commit -m "refactor(build): share zclaudia_resolve_release_repo across android/macos (QA-0054)"
```

---

### Task 3: Close QA-0054

**Files:** Modify `docs/quality-audit/findings.json`, `docs/quality-audit/PROGRESS.md`.

- [ ] **Step 1:** Set QA-0054 `status` to `"fixed"` and update `verificationNote`: both remaining
  clean duplications (Tauri semver strip; release-repo slug) now shared via `common.sh`; the
  install/build block was left inline (not clean duplication) and signing/artifact logic is
  genuinely platform-specific. Verified via `bash -n` on all four scripts.
- [ ] **Step 2:** In `PROGRESS.md`, mark QA-0054 ✅ CLOSED, mirroring QA-0027/QA-0034; note the
  remaining size is irreducible platform-specific logic. Update the "maintainability partials"
  intro (no partials remain).
- [ ] **Step 3:** Commit:
```bash
git add docs/quality-audit/findings.json docs/quality-audit/PROGRESS.md
git commit -m "docs(quality-audit): close QA-0054 after sharing build helpers"
```

## Self-review

- Spec coverage: both helpers (Tasks 1-2) + close (Task 3). install/build & signing explicitly out of scope.
- No placeholders; exact old→new strings given.
- Helper names consistent across tasks (`zclaudia_tauri_semver`, `zclaudia_resolve_release_repo`).
