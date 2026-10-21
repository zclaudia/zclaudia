/**
 * Per-session shell cwd tracking for the Bash tool.
 *
 * Foreground Bash spawns a fresh `bash -c <command>` process per call
 * (bash-runner.ts), so a `cd` inside one call dies with its shell. Sessions
 * still expect cd to carry into the next call, so the executed command gets a
 * probe appended that prints the shell's final physical cwd; the tool layer
 * stores it here and uses it as the next call's start directory. Semantics
 * follow ZCode apps/zcode-cli/packages/core/src/tool/handlers/
 * bash-cwd-policy.ts (Apache-2.0): persist only on success, and reset to the
 * workspace root with a visible note when the shell left the workspace.
 */

import { realpathSync } from 'fs';
import * as path from 'path';

/** Output line prefix printed by the cwd probe; the remainder of the line is the cwd. */
export const BASH_CWD_PROBE_MARKER = '__ZCLAUDIA_CWD__';

/**
 * Re-express a physical (`pwd -P`) cwd in the workspace roots' own spelling.
 * `pwd -P` resolves symlinks (macOS /var → /private/var), which would leave the
 * tracked cwd lexically foreign to the workspace root and make
 * workspace-relative display paths ugly; mapping back through the root's
 * realpath keeps the stored path in the form the root was configured with.
 */
export function denormalizePhysicalCwd(
  physical: string,
  roots: { primary: string; additional?: readonly string[] }
): string {
  let realPhysical: string;
  try {
    realPhysical = realpathSync.native(physical);
  } catch {
    return physical;
  }
  for (const root of [roots.primary, ...(roots.additional ?? [])]) {
    try {
      const relative = path.relative(realpathSync.native(root), realPhysical);
      if (relative === '') return path.resolve(root);
      if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
        return path.join(path.resolve(root), relative);
      }
    } catch {
      // unreadable root: try the next one
    }
  }
  return physical;
}

/**
 * Append the cwd probe to the command actually executed. The probe preserves
 * the user command's exit code and prints the marker plus `pwd -P` (physical
 * path, so symlinked cwd does not break workspace-containment checks). If the
 * command replaces the shell (`exec`, bare `exit`) the probe never runs: no
 * marker is printed and the tracked cwd simply stays unchanged.
 */
export function appendBashCwdProbe(command: string): string {
  return (
    `${command}; __zclaudia_probe_rc=$?; ` +
    `printf '%s\\n' '${BASH_CWD_PROBE_MARKER}'"$(pwd -P)"; exit $__zclaudia_probe_rc`
  );
}

export interface StrippedBashCwdProbe {
  output: string;
  fullOutput: string;
  /** Last cwd reported by the probe, when one was printed. */
  capturedCwd?: string;
}

const CWD_PROBE_LINE = new RegExp(`${BASH_CWD_PROBE_MARKER}([^\\r\\n]*)`, 'g');

function stripMarker(text: string): { text: string; capturedCwd?: string } {
  let capturedCwd: string | undefined;
  let cleaned = text.replace(CWD_PROBE_LINE, (_match, value: string) => {
    // replace() walks left to right, so the last assignment wins — the probe
    // prints after all command output, making the final occurrence the real one.
    capturedCwd = value.trim();
    return '';
  });
  if (capturedCwd !== undefined) cleaned = cleaned.replace(/\s+$/, '');
  return { text: cleaned, ...(capturedCwd !== undefined ? { capturedCwd } : {}) };
}

/**
 * Remove the probe marker line from a command's output and report the captured
 * cwd. Applied to the runner result's display tail and full output so the
 * bookkeeping line never reaches the model or the UI.
 */
export function stripBashCwdProbe(output: string, fullOutput: string): StrippedBashCwdProbe {
  const strippedOutput = stripMarker(output);
  const strippedFull = stripMarker(fullOutput);
  return {
    output: strippedOutput.text,
    fullOutput: strippedFull.text,
    ...(strippedFull.capturedCwd !== undefined
      ? { capturedCwd: strippedFull.capturedCwd }
      : strippedOutput.capturedCwd !== undefined
        ? { capturedCwd: strippedOutput.capturedCwd }
        : {}),
  };
}

// Tool instances are rebuilt per run (agent-loop/toolsets.ts calls buildTools
// for every run), so session cwd must outlive one instance: it is keyed by
// sessionId in this module-level map. Bounded LRU-style: sessions end, and an
// unbounded map would leak one entry per session for the server's lifetime.
const MAX_TRACKED_SESSION_CWDS = 256;
const sessionShellCwds = new Map<string, string>();

export function getTrackedSessionCwd(sessionId: string): string | undefined {
  const cwd = sessionShellCwds.get(sessionId);
  if (cwd === undefined) return undefined;
  // Refresh recency so the oldest entry is always the least recently used.
  sessionShellCwds.delete(sessionId);
  sessionShellCwds.set(sessionId, cwd);
  return cwd;
}

export function trackSessionCwd(sessionId: string, cwd: string): void {
  sessionShellCwds.delete(sessionId);
  sessionShellCwds.set(sessionId, cwd);
  while (sessionShellCwds.size > MAX_TRACKED_SESSION_CWDS) {
    const oldest = sessionShellCwds.keys().next().value;
    if (oldest === undefined) break;
    sessionShellCwds.delete(oldest);
  }
}

export function forgetSessionCwd(sessionId: string): void {
  sessionShellCwds.delete(sessionId);
}

export function __resetSessionCwdsForTests(): void {
  sessionShellCwds.clear();
}
