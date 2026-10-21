import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm } from 'fs/promises';
import { realpathSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

import {
  BASH_CWD_PROBE_MARKER,
  __resetSessionCwdsForTests,
  appendBashCwdProbe,
  denormalizePhysicalCwd,
  forgetSessionCwd,
  getTrackedSessionCwd,
  stripBashCwdProbe,
  trackSessionCwd,
} from '../bash-session-cwd.js';

describe('appendBashCwdProbe', () => {
  it('appends a probe that preserves the exit code and prints the physical cwd', () => {
    const wrapped = appendBashCwdProbe('cd sub');
    expect(wrapped.startsWith('cd sub; ')).toBe(true);
    expect(wrapped).toContain('__zclaudia_probe_rc=$?');
    expect(wrapped).toContain(`printf '%s\\n' '${BASH_CWD_PROBE_MARKER}'"$(pwd -P)"`);
    expect(wrapped.endsWith('exit $__zclaudia_probe_rc')).toBe(true);
  });
});

describe('stripBashCwdProbe', () => {
  it('strips a marker line and captures the cwd', () => {
    const stripped = stripBashCwdProbe(
      'hello\n__ZCLAUDIA_CWD__/tmp/w\n',
      'hello\n__ZCLAUDIA_CWD__/tmp/w\n'
    );
    expect(stripped.output).toBe('hello');
    expect(stripped.fullOutput).toBe('hello');
    expect(stripped.capturedCwd).toBe('/tmp/w');
  });

  it('handles a marker glued to output without a trailing newline', () => {
    const stripped = stripBashCwdProbe(
      'hello__ZCLAUDIA_CWD__/tmp/w',
      'hello__ZCLAUDIA_CWD__/tmp/w'
    );
    expect(stripped.output).toBe('hello');
    expect(stripped.fullOutput).toBe('hello');
    expect(stripped.capturedCwd).toBe('/tmp/w');
  });

  it('returns text unchanged and no cwd when the probe never printed', () => {
    const stripped = stripBashCwdProbe('plain output\n', 'plain output\n');
    expect(stripped.output).toBe('plain output\n');
    expect(stripped.fullOutput).toBe('plain output\n');
    expect(stripped.capturedCwd).toBeUndefined();
  });

  it('keeps the last marker when the command echoed the marker itself', () => {
    const output = '__ZCLAUDIA_CWD__/fake\nreal\n__ZCLAUDIA_CWD__/real/path\n';
    const stripped = stripBashCwdProbe(output, output);
    expect(stripped.capturedCwd).toBe('/real/path');
    expect(stripped.output).not.toContain(BASH_CWD_PROBE_MARKER);
  });

  it('strips carriage returns at the marker line end', () => {
    const stripped = stripBashCwdProbe(
      'out\r\n__ZCLAUDIA_CWD__/tmp/w\r\n',
      'out\r\n__ZCLAUDIA_CWD__/tmp/w\r\n'
    );
    expect(stripped.capturedCwd).toBe('/tmp/w');
  });
});

describe('denormalizePhysicalCwd', () => {
  it('re-expresses a realpath-resolved cwd in the workspace root spelling', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zclaudia-cwd-denorm-'));
    await mkdir(path.join(root, 'sub'), { recursive: true });
    const physical = realpathSync(path.join(root, 'sub'));
    const denormalized = denormalizePhysicalCwd(physical, { primary: root });
    expect(denormalized).toBe(path.join(path.resolve(root), 'sub'));
    await rm(root, { recursive: true, force: true });
  });

  it('returns the physical path when it is outside all roots', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zclaudia-cwd-denorm-'));
    const outside = await mkdtemp(path.join(tmpdir(), 'zclaudia-cwd-outside-'));
    expect(denormalizePhysicalCwd(outside, { primary: root })).toBe(outside);
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  it('maps a cwd equal to the root itself back to the root spelling', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'zclaudia-cwd-denorm-'));
    expect(denormalizePhysicalCwd(realpathSync(root), { primary: root })).toBe(path.resolve(root));
    await rm(root, { recursive: true, force: true });
  });
});

describe('session cwd store', () => {
  it('tracks, reads, and forgets per session', () => {
    __resetSessionCwdsForTests();
    expect(getTrackedSessionCwd('s1')).toBeUndefined();
    trackSessionCwd('s1', '/tmp/a');
    expect(getTrackedSessionCwd('s1')).toBe('/tmp/a');
    trackSessionCwd('s1', '/tmp/b');
    expect(getTrackedSessionCwd('s1')).toBe('/tmp/b');
    forgetSessionCwd('s1');
    expect(getTrackedSessionCwd('s1')).toBeUndefined();
  });

  it('evicts the least recently used session past the cap', () => {
    __resetSessionCwdsForTests();
    for (let i = 0; i < 256; i += 1) trackSessionCwd(`s${i}`, `/tmp/${i}`);
    // Reading s0 refreshes it, so s1 becomes the oldest entry.
    expect(getTrackedSessionCwd('s0')).toBe('/tmp/0');
    trackSessionCwd('s256', '/tmp/256');
    expect(getTrackedSessionCwd('s0')).toBe('/tmp/0');
    expect(getTrackedSessionCwd('s1')).toBeUndefined();
    expect(getTrackedSessionCwd('s256')).toBe('/tmp/256');
  });
});
