import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleBrowserMessage } from '../browser.js';

function stubManager() {
  return {
    open: vi.fn(async () => {}),
    attach: vi.fn(async () => {}),
    detach: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    navigate: vi.fn(async () => {}),
    history: vi.fn(async () => {}),
    reload: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    input: vi.fn(async () => {}),
    resize: vi.fn(async () => {}),
  };
}

const client = { id: 'c1', ws: {} } as never;
const viewport = { width: 800, height: 600, dpr: 1 };

describe('handleBrowserMessage', () => {
  let mgr: ReturnType<typeof stubManager>;
  beforeEach(() => {
    mgr = stubManager();
  });

  it('returns false for non-browser messages', () => {
    const handled = handleBrowserMessage(client, { type: 'ping' } as never, mgr as never, () => {});
    expect(handled).toBe(false);
  });

  it('routes open with client id', () => {
    handleBrowserMessage(client, { type: 'browser_open', sessionId: 's1', url: 'http://x/' }, mgr as never, () => {});
    expect(mgr.open).toHaveBeenCalledWith('c1', 's1', 'http://x/');
  });

  it('normalizes open URLs the same as navigate (bare host gains https://)', () => {
    handleBrowserMessage(client, { type: 'browser_open', sessionId: 's1', url: 'example.com' }, mgr as never, () => {});
    expect(mgr.open).toHaveBeenCalledWith('c1', 's1', 'https://example.com');
  });

  it('passes open through with no url when none is given', () => {
    handleBrowserMessage(client, { type: 'browser_open', sessionId: 's1' }, mgr as never, () => {});
    expect(mgr.open).toHaveBeenCalledWith('c1', 's1', undefined);
  });

  it('routes attach/detach/close with the client id (ownership checks)', () => {
    handleBrowserMessage(client, { type: 'browser_attach', sessionId: 's1', viewport }, mgr as never, () => {});
    handleBrowserMessage(client, { type: 'browser_detach', sessionId: 's1' }, mgr as never, () => {});
    handleBrowserMessage(client, { type: 'browser_close', sessionId: 's1' }, mgr as never, () => {});
    expect(mgr.attach).toHaveBeenCalledWith('c1', 's1', viewport);
    expect(mgr.detach).toHaveBeenCalledWith('c1', 's1');
    expect(mgr.close).toHaveBeenCalledWith('c1', 's1', 'user');
  });

  it('normalizes navigate URLs (adds https://, passes localhost through as http)', () => {
    handleBrowserMessage(client, { type: 'browser_navigate', sessionId: 's1', url: 'example.com' }, mgr as never, () => {});
    expect(mgr.navigate).toHaveBeenCalledWith('s1', 'https://example.com');
    handleBrowserMessage(client, { type: 'browser_navigate', sessionId: 's1', url: 'localhost:5173' }, mgr as never, () => {});
    expect(mgr.navigate).toHaveBeenCalledWith('s1', 'http://localhost:5173');
  });

  it('routes input and resize', () => {
    const event = { kind: 'mouse', type: 'move', x: 1, y: 2 } as const;
    handleBrowserMessage(client, { type: 'browser_input', sessionId: 's1', event }, mgr as never, () => {});
    handleBrowserMessage(client, { type: 'browser_resize', sessionId: 's1', viewport }, mgr as never, () => {});
    expect(mgr.input).toHaveBeenCalledWith('s1', event);
    expect(mgr.resize).toHaveBeenCalledWith('s1', viewport);
  });
});
