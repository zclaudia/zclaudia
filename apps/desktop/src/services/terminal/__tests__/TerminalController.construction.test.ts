/**
 * Covers the real (non-factories) xterm construction branch of ensureTerminal,
 * which TerminalController.test.ts deliberately bypasses via the factories hook.
 */
import { describe, it, expect, vi } from 'vitest';

const ctorOptions = vi.hoisted(() => [] as any[]);

vi.mock('@xterm/xterm', () => {
  class MockTerminal {
    open = vi.fn();
    dispose = vi.fn();
    onData = vi.fn(() => ({ dispose: vi.fn() }));
    write = vi.fn();
    focus = vi.fn();
    loadAddon = vi.fn();
    options: any = {};
    cols = 80;
    rows = 24;
    constructor(opts: any) {
      ctorOptions.push(opts);
    }
  }
  return { Terminal: MockTerminal };
});

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit = vi.fn();
    dispose = vi.fn();
    activate = vi.fn();
  },
}));

vi.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: class {
    dispose = vi.fn();
    activate = vi.fn();
  },
}));

import { TerminalController } from '../TerminalController';

describe('TerminalController xterm construction', () => {
  it('constructs the Terminal with a 4.5 minimum contrast ratio and the deps theme', () => {
    const theme = { background: '#000000' };
    const controller = new TerminalController({
      terminalId: 'term-1',
      sendMessage: vi.fn(),
      getTheme: () => theme,
    });

    controller.open({ projectId: 'proj-1' });

    expect(ctorOptions).toHaveLength(1);
    expect(ctorOptions[0].minimumContrastRatio).toBe(4.5);
    expect(ctorOptions[0].theme).toBe(theme);
  });
});
