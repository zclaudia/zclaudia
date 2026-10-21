import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useUIStore, FONT_CONFIGS, MOBILE_FONT_CONFIGS, type FontSizePreset } from '../uiStore';

describe('uiStore', () => {
  beforeEach(() => {
    // Reset store to default medium font size
    useUIStore.setState({ fontSize: 'medium' });
    localStorage.clear();
  });

  describe('initial state', () => {
    it('has a valid font size preset', () => {
      const fontSize = useUIStore.getState().fontSize;
      expect(['small', 'medium', 'large']).toContain(fontSize);
    });
  });

  describe('setFontSize', () => {
    it('sets font size to small', () => {
      useUIStore.getState().setFontSize('small');
      expect(useUIStore.getState().fontSize).toBe('small');
    });

    it('sets font size to medium', () => {
      useUIStore.getState().setFontSize('small');
      useUIStore.getState().setFontSize('medium');
      expect(useUIStore.getState().fontSize).toBe('medium');
    });

    it('sets font size to large', () => {
      useUIStore.getState().setFontSize('large');
      expect(useUIStore.getState().fontSize).toBe('large');
    });

    it('persists to localStorage', () => {
      useUIStore.getState().setFontSize('large');
      expect(localStorage.getItem('zclaudia-font-size')).toBe('large');
    });

    it('switching between all sizes works correctly', () => {
      const sizes: FontSizePreset[] = ['small', 'medium', 'large'];

      for (const size of sizes) {
        useUIStore.getState().setFontSize(size);
        expect(useUIStore.getState().fontSize).toBe(size);
      }
    });
  });

  describe('FONT_CONFIGS', () => {
    it('has configs for all three presets', () => {
      expect(FONT_CONFIGS).toHaveProperty('small');
      expect(FONT_CONFIGS).toHaveProperty('medium');
      expect(FONT_CONFIGS).toHaveProperty('large');
    });

    it('each config has all required fields', () => {
      const requiredFields = ['prose', 'code', 'input', 'h1', 'h2', 'h3'];

      for (const preset of ['small', 'medium', 'large'] as FontSizePreset[]) {
        for (const field of requiredFields) {
          expect(FONT_CONFIGS[preset]).toHaveProperty(field);
          expect(typeof FONT_CONFIGS[preset][field as keyof typeof FONT_CONFIGS.small]).toBe(
            'string'
          );
        }
      }
    });

    it('small font sizes are smaller than medium', () => {
      expect(parseFloat(FONT_CONFIGS.small.prose)).toBeLessThan(
        parseFloat(FONT_CONFIGS.medium.prose)
      );
      expect(parseFloat(FONT_CONFIGS.small.code)).toBeLessThan(
        parseFloat(FONT_CONFIGS.medium.code)
      );
    });

    it('medium font sizes are smaller than large', () => {
      expect(parseFloat(FONT_CONFIGS.medium.prose)).toBeLessThan(
        parseFloat(FONT_CONFIGS.large.prose)
      );
      expect(parseFloat(FONT_CONFIGS.medium.code)).toBeLessThan(
        parseFloat(FONT_CONFIGS.large.code)
      );
    });
  });

  describe('mobile font sizes', () => {
    const mockViewport = (mobile: boolean) =>
      vi.spyOn(window, 'matchMedia').mockImplementation(
        query =>
          ({
            matches: mobile && query === '(max-width: 767px)',
            media: query,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
          }) as unknown as MediaQueryList
      );
    const rootVar = (name: string) => document.documentElement.style.getPropertyValue(name);

    afterEach(() => vi.restoreAllMocks());

    it('steps every preset up from its desktop size', () => {
      for (const preset of ['small', 'medium', 'large'] as FontSizePreset[]) {
        for (const field of ['prose', 'code', 'input'] as const) {
          expect(parseFloat(MOBILE_FONT_CONFIGS[preset][field])).toBeGreaterThan(
            parseFloat(FONT_CONFIGS[preset][field])
          );
        }
      }
    });

    it('applies the mobile table on a phone viewport', () => {
      mockViewport(true);
      useUIStore.getState().setFontSize('medium');
      expect(rootVar('--chat-font-prose')).toBe(MOBILE_FONT_CONFIGS.medium.prose);
      expect(rootVar('--chat-font-input')).toBe(MOBILE_FONT_CONFIGS.medium.input);
    });

    it('keeps the desktop table on a wide viewport', () => {
      mockViewport(false);
      useUIStore.getState().setFontSize('medium');
      expect(rootVar('--chat-font-prose')).toBe(FONT_CONFIGS.medium.prose);
      expect(rootVar('--chat-font-input')).toBe(FONT_CONFIGS.medium.input);
    });
  });

  describe('forceScrollToBottom', () => {
    it('requestForceScrollToBottom sets sessionId', () => {
      useUIStore.getState().requestForceScrollToBottom('s1');
      expect(useUIStore.getState().forceScrollToBottomSessionId).toBe('s1');
    });

    it('consumeForceScrollToBottom clears matching sessionId', () => {
      useUIStore.getState().requestForceScrollToBottom('s1');
      useUIStore.getState().consumeForceScrollToBottom('s1');
      expect(useUIStore.getState().forceScrollToBottomSessionId).toBeNull();
    });

    it('consumeForceScrollToBottom ignores non-matching sessionId', () => {
      useUIStore.getState().requestForceScrollToBottom('s1');
      useUIStore.getState().consumeForceScrollToBottom('s2');
      expect(useUIStore.getState().forceScrollToBottomSessionId).toBe('s1');
    });
  });

  describe('poppedOutSessions', () => {
    it('addPoppedOutSession tracks session/window pair', () => {
      useUIStore.getState().addPoppedOutSession('s1', 'window-1');
      expect(useUIStore.getState().poppedOutSessions.get('s1')).toBe('window-1');
    });

    it('removePoppedOutSession removes session', () => {
      useUIStore.getState().addPoppedOutSession('s1', 'w1');
      useUIStore.getState().removePoppedOutSession('s1');
      expect(useUIStore.getState().poppedOutSessions.has('s1')).toBe(false);
    });

    it('supports multiple popped out sessions', () => {
      useUIStore.getState().addPoppedOutSession('s1', 'w1');
      useUIStore.getState().addPoppedOutSession('s2', 'w2');
      expect(useUIStore.getState().poppedOutSessions.size).toBe(2);
    });
  });
});
