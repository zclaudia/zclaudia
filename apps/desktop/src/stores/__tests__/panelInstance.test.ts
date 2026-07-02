import { describe, it, expect } from 'vitest';
import { MULTI_INSTANCE_PANELS, isSingleton } from '../panelInstance';

describe('panelInstance', () => {
  describe('MULTI_INSTANCE_PANELS / isSingleton', () => {
    it('only terminal is multi-instance in the MVP', () => {
      expect([...MULTI_INSTANCE_PANELS]).toEqual(['terminal']);
      expect(isSingleton('terminal')).toBe(false);
      expect(isSingleton('file-viewer')).toBe(true);
      expect(isSingleton('draft')).toBe(true);
      expect(isSingleton('memory')).toBe(true);
      expect(isSingleton('session-changes')).toBe(true);
      expect(isSingleton('notifications')).toBe(true);
      expect(isSingleton('lineage')).toBe(true);
    });

    it('isSingleton returns false for any panel in MULTI_INSTANCE_PANELS', () => {
      for (const id of MULTI_INSTANCE_PANELS) {
        expect(isSingleton(id)).toBe(false);
      }
    });

    it('isSingleton returns true for panels not in MULTI_INSTANCE_PANELS', () => {
      expect(isSingleton('draft')).toBe(true);
      expect(isSingleton('memory')).toBe(true);
    });
  });
});
