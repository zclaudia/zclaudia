import { describe, expect, it } from 'vitest';
import {
  isObfuscatedSensitiveHomePath,
  isSensitiveHomePath,
  SENSITIVE_HOME_LITERALS,
  SENSITIVE_HOME_PATHS,
  SENSITIVE_HOME_SPEC,
} from '../bash-guards/sensitive-home.js';

/**
 * Regression guard for the single-source-of-truth invariant: PATHS and
 * LITERALS must stay derived from SENSITIVE_HOME_SPEC, so the two views can
 * never drift apart (the failure mode this module was extracted to prevent).
 * Behavioral coverage of the sensitive-path check lives in bash-guards.test.ts.
 */
describe('sensitive-home single source of truth', () => {
  it('PATHS and LITERALS are derived from SENSITIVE_HOME_SPEC, one-to-one, same order', () => {
    // Cardinality: both views are exactly the spec projected.
    expect(SENSITIVE_HOME_PATHS).toHaveLength(SENSITIVE_HOME_SPEC.length);
    expect(SENSITIVE_HOME_LITERALS).toHaveLength(SENSITIVE_HOME_SPEC.length);
    // LITERALS is the identity projection of spec.literal.
    expect(SENSITIVE_HOME_LITERALS).toEqual(SENSITIVE_HOME_SPEC.map(entry => entry.literal));
    // PATHS is the per-entry matcher: each regex matches the spec entry's own
    // literal exactly once. Verifying behavior (not .source strings) keeps the
    // assertion free of the implementation's escaping details.
    for (let i = 0; i < SENSITIVE_HOME_SPEC.length; i += 1) {
      expect(SENSITIVE_HOME_PATHS[i].test(SENSITIVE_HOME_SPEC[i].literal)).toBe(true);
    }
  });

  it('adding a path to the spec makes it both regex- and literal-matchable', () => {
    // Sample one directory-kind and one file-kind entry and confirm BOTH
    // detection surfaces agree it is sensitive — i.e. a new spec entry cannot
    // silently miss either view.
    const dir = SENSITIVE_HOME_SPEC.find(entry => entry.kind === 'directory')!;
    const file = SENSITIVE_HOME_SPEC.find(entry => entry.kind === 'file')!;
    expect(isSensitiveHomePath(dir.literal)).toBe(true);
    expect(isSensitiveHomePath(file.literal)).toBe(true);
    // The obfuscation check keys off the literal prefix, so a literal prefix
    // of any spec entry must read as an obfuscated-sensitive candidate.
    expect(isObfuscatedSensitiveHomePath(`${dir.literal.slice(0, -1)}*`)).toBe(true);
  });

  it('every directory-kind spec entry also matches paths nested under it', () => {
    for (const entry of SENSITIVE_HOME_SPEC) {
      if (entry.kind !== 'directory') continue;
      expect(isSensitiveHomePath(`${entry.literal}/deeper/file`)).toBe(true);
    }
  });

  it('file-kind spec entries do NOT match paths nested under them', () => {
    for (const entry of SENSITIVE_HOME_SPEC) {
      if (entry.kind !== 'file') continue;
      expect(isSensitiveHomePath(`${entry.literal}/deeper`)).toBe(false);
    }
  });

  it('public SSH material and non-secret config stay allowed-back', () => {
    expect(isSensitiveHomePath('~/.ssh/config')).toBe(false);
    expect(isSensitiveHomePath('~/.ssh/known_hosts')).toBe(false);
    expect(isSensitiveHomePath('~/.ssh/id_rsa.pub')).toBe(false);
    expect(isSensitiveHomePath('~/.aws/config')).toBe(false);
    expect(isSensitiveHomePath('~/.config/gh/config.yml')).toBe(false);
  });
});
