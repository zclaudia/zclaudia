import { describe, expect, it } from 'vitest';
import { parseReservedNamespace } from '../namespace-parser.js';

const OPTS = { activeRuntimeType: 'claude' };

describe('parseReservedNamespace', () => {
  it('recognizes /zc: at byte zero', () => {
    expect(parseReservedNamespace('/zc:help', OPTS)).toMatchObject({
      namespace: 'zc',
      name: 'help',
      rawName: 'help',
      argumentSuffix: '',
    });
  });

  it('recognizes /skill: with a raw argument suffix preserved byte-for-byte', () => {
    const parsed = parseReservedNamespace('/skill:release  ZOOM-1   "quoted  text"', OPTS);
    expect(parsed).toMatchObject({ namespace: 'skill', name: 'release' });
    // Exactly one structural space is consumed; the rest stays byte-for-byte.
    expect(parsed!.argumentSuffix).toBe(' ZOOM-1   "quoted  text"');
  });

  it('recognizes the active runtime namespace', () => {
    expect(parseReservedNamespace('/claude:review --deep', OPTS)).toMatchObject({
      namespace: 'runtime',
      name: 'review',
      argumentSuffix: '--deep',
    });
  });

  it('rejects namespaces for inactive runtimes', () => {
    expect(parseReservedNamespace('/codex:review', OPTS)).toBeNull();
  });

  it('never interprets unqualified /name', () => {
    expect(parseReservedNamespace('/review something', OPTS)).toBeNull();
  });

  it('ignores reserved-looking tokens later in the message', () => {
    expect(parseReservedNamespace('hello /zc:help', OPTS)).toBeNull();
    expect(parseReservedNamespace('see /skill:foo for details', OPTS)).toBeNull();
  });

  it('rejects an empty name', () => {
    expect(parseReservedNamespace('/zc:', OPTS)).toBeNull();
  });

  it('treats malformed prefixes as plain text', () => {
    expect(parseReservedNamespace('/1nvalid:thing', OPTS)).toBeNull();
    expect(parseReservedNamespace('/', OPTS)).toBeNull();
  });
});
