import { describe, it, expect } from 'vitest';
import { resolveSessionDisplayName } from '../sessionDisplayName';

const session = (over: Record<string, unknown> = {}) =>
  ({ id: 's1', autoTitlePending: false, ...over }) as Parameters<
    typeof resolveSessionDisplayName
  >[0];

describe('resolveSessionDisplayName', () => {
  it('user name wins over the auto-title', () => {
    expect(
      resolveSessionDisplayName(session({ name: 'My name', autoTitle: 'Auto title' })).text
    ).toBe('My name');
  });

  it('falls back to the auto-title, then the default fallback', () => {
    expect(resolveSessionDisplayName(session({ autoTitle: 'Refactor the parser' })).text).toBe(
      'Refactor the parser'
    );
    expect(resolveSessionDisplayName(session()).text).toBe('Untitled Session');
  });

  it('honors a custom fallback and handles missing sessions', () => {
    expect(resolveSessionDisplayName(undefined, 'chat').text).toBe('chat');
    expect(resolveSessionDisplayName(null, 'Untitled').text).toBe('Untitled');
  });

  it('flags pending only for unnamed sessions with generation in flight', () => {
    expect(resolveSessionDisplayName(session({ autoTitlePending: true })).titlePending).toBe(true);
    // A user name or an existing title is already a real display name.
    expect(
      resolveSessionDisplayName(session({ name: 'x', autoTitlePending: true })).titlePending
    ).toBe(false);
    expect(
      resolveSessionDisplayName(session({ autoTitle: 't', autoTitlePending: true })).titlePending
    ).toBe(false);
    expect(resolveSessionDisplayName(session()).titlePending).toBe(false);
  });
});
