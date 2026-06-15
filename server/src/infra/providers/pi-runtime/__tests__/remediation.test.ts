import { describe, it, expect } from 'vitest';
import { remediationForResult } from '../remediation.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function det(d: Record<string, unknown>): any {
  return d;
}

describe('remediationForResult', () => {
  it('returns undefined for successful results', () => {
    expect(remediationForResult('Edit', det({ ok: true }))).toBeUndefined();
    expect(remediationForResult('Bash', det({ ok: true, exitCode: 0 }))).toBeUndefined();
  });

  it('returns undefined when there is no details object', () => {
    expect(remediationForResult('Edit', undefined)).toBeUndefined();
  });

  it('suggests re-reading on Edit not_found', () => {
    const hint = remediationForResult('Edit', det({ ok: false, error: 'not_found' }));
    expect(hint).toMatch(/read/i);
    expect(hint).toMatch(/whitespace|exact|indentation/i);
  });

  it('suggests replace_all or more context on Edit not_unique', () => {
    const hint = remediationForResult('Edit', det({ ok: false, error: 'not_unique', occurrences: 3 }));
    expect(hint).toMatch(/replace_all|more context/i);
  });

  it('suggests a fresh hashline read on hashline_mismatch', () => {
    const hint = remediationForResult('Edit', det({ ok: false, error: 'hashline_mismatch' }));
    expect(hint).toMatch(/hashline/i);
  });

  it('does not pile on when the loop guard already fired', () => {
    expect(remediationForResult('Edit', det({ ok: false, error: 'edit_loop_detected' }))).toBeUndefined();
  });

  it('explains command-not-found Bash exits', () => {
    const hint = remediationForResult('Bash', det({ ok: false, exitCode: 127 }));
    expect(hint).toMatch(/not found|not installed|PATH/i);
  });

  it('flags workspace-relative path errors', () => {
    const hint = remediationForResult('Write', det({ ok: false, error: 'path_outside_workspace' }));
    expect(hint).toMatch(/workspace-relative|inside the workspace/i);
  });

  it('explains stale-read write rejections', () => {
    const hint = remediationForResult('Write', det({ ok: false, error: 'file_modified_since_read' }));
    expect(hint).toMatch(/read .* again|re-read/i);
  });

  it('explains auto-generated refusals', () => {
    const hint = remediationForResult('Edit', det({ ok: false, error: 'auto_generated_file' }));
    expect(hint).toMatch(/generated|source/i);
  });

  it('steers to a workspace-relative path on sandbox write-outside-workspace denial', () => {
    const hint = remediationForResult('Bash', det({
      ok: false,
      exitCode: 1,
      sandboxed: true,
      sandboxFsDenied: 'write_outside_workspace',
    }));
    expect(hint).toMatch(/workspace-relative|workspace root/i);
    expect(hint).toMatch(/sandbox/i);
  });

  it('steers to ExitPlanMode on read-only sandbox denial', () => {
    const hint = remediationForResult('Bash', det({
      ok: false,
      exitCode: 1,
      sandboxed: true,
      sandboxFsDenied: 'read_only',
    }));
    expect(hint).toMatch(/ExitPlanMode|Plan mode/);
  });

  it('points at the full output file when a Bash result was persisted', () => {
    const hint = remediationForResult('Bash', det({ ok: false, exitCode: 1, fullOutputPath: '/tmp/x.log' }));
    // exitCode 1 alone is generic; should not over-explain, but may surface the log
    expect(hint === undefined || /\/tmp\/x\.log|full output/.test(hint)).toBe(true);
  });

  it('returns undefined for unknown error codes', () => {
    expect(remediationForResult('Grep', det({ ok: false, error: 'some_novel_error' }))).toBeUndefined();
  });

  describe('remediationForResult — tool_loop_detected', () => {
    it('returns undefined (self-explanatory) for tool_loop_detected even with a fallback-triggered hint context', () => {
      // With a .fullOutputPath that would normally trigger a hint for generic Bash failure,
      // tool_loop_detected should still suppress it (it's self-explanatory).
      expect(remediationForResult('Bash', {
        ok: false,
        error: 'tool_loop_detected',
        exitCode: 1,
        fullOutputPath: '/tmp/output.log',
      } as any)).toBeUndefined();
    });

    it('suppresses the Bash fullOutputPath hint when the loop guard fires (load-bearing)', () => {
      // Without tool_loop_detected in SELF_EXPLANATORY this Bash failure would
      // return the "full output is at ..." hint; membership must short-circuit it.
      expect(
        remediationForResult('Bash', {
          ok: false,
          error: 'tool_loop_detected',
          exitCode: 1,
          fullOutputPath: '/tmp/x.txt',
        } as any),
      ).toBeUndefined();
    });
  });
});
