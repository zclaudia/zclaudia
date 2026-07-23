import { describe, expect, it } from 'vitest';

import { applyLineEndingStyle, lineEndingFor } from '../text-io.js';

describe('lineEndingFor', () => {
  it('returns LF for pure-LF content', () => {
    expect(lineEndingFor('one\ntwo\nthree\n')).toBe('LF');
  });

  it('returns CRLF for pure-CRLF content', () => {
    expect(lineEndingFor('one\r\ntwo\r\nthree\r\n')).toBe('CRLF');
  });

  it('returns CRLF for a single CRLF line', () => {
    expect(lineEndingFor('one\r\n')).toBe('CRLF');
  });

  it('follows the majority in mixed-ending content', () => {
    // One stray CRLF line must not flip a LF file to CRLF.
    expect(lineEndingFor('one\ntwo\r\nthree\nfour\n')).toBe('LF');
    // ...and one stray LF line must not flip a CRLF file to LF.
    expect(lineEndingFor('one\r\ntwo\nthree\r\nfour\r\n')).toBe('CRLF');
  });

  it('resolves ties and newline-free content to LF', () => {
    expect(lineEndingFor('one\ntwo\r\n')).toBe('LF');
    expect(lineEndingFor('no newline at all')).toBe('LF');
    expect(lineEndingFor('')).toBe('LF');
  });

  it('ignores lone carriage returns', () => {
    expect(lineEndingFor('one\rtwo\nthree\n')).toBe('LF');
  });
});

describe('applyLineEndingStyle', () => {
  it('normalizes to the requested style', () => {
    expect(applyLineEndingStyle('a\nb\n', 'CRLF')).toBe('a\r\nb\r\n');
    expect(applyLineEndingStyle('a\r\nb\r\n', 'LF')).toBe('a\nb\n');
    expect(applyLineEndingStyle('a\r\nb\n', 'CRLF')).toBe('a\r\nb\r\n');
  });
});
