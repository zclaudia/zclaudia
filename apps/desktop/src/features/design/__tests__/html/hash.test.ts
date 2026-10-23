// @vitest-environment jsdom
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sha256Hex, sha256HexSync } from '../../html/hash';

const inputs = [
  '',
  'x',
  'abc',
  'hello world',
  '咖啡馆',
  'line1\r\nline2\n',
  'a'.repeat(200),
  '🫖'.repeat(100),
];

describe('sha256 fallback', () => {
  it('matches node:crypto on all vectors', () => {
    for (const input of inputs) {
      const expected = createHash('sha256').update(input, 'utf8').digest('hex');
      expect(sha256HexSync(input)).toBe(expected);
    }
  });
  it('sha256Hex falls back in jsdom and still matches', async () => {
    expect((globalThis as { crypto?: { subtle?: unknown } }).crypto?.subtle).toBeUndefined();
    for (const input of inputs.slice(0, 4)) {
      expect(await sha256Hex(input)).toBe(
        createHash('sha256').update(input, 'utf8').digest('hex')
      );
    }
  });
});
