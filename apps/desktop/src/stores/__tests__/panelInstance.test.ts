import { describe, it, expect } from 'vitest';
import {
  MULTI_INSTANCE_PANELS,
  isSingleton,
  findSingletonConflict,
} from '../panelInstance';
import type { LayoutNode, PaneNode, GroupNode } from '../splitLayoutStore';

const pane = (id: string, panelId: string, instanceKey?: string): PaneNode => ({
  id, kind: 'pane', panelId, ...(instanceKey !== undefined ? { instanceKey } : {}),
});

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
  });

  describe('findSingletonConflict', () => {
    it('returns null when no pane has the panel id', () => {
      const root: LayoutNode = pane('p1', 'draft');
      expect(findSingletonConflict(root, 'memory', undefined, 'p1')).toBeNull();
    });

    it('returns null when the only matching pane is the excluded one', () => {
      const root: LayoutNode = pane('p1', 'draft');
      // Replacing/splitting p1 itself with draft must not self-conflict.
      expect(findSingletonConflict(root, 'draft', undefined, 'p1')).toBeNull();
    });

    it('returns the conflicting pane id for a singleton already present elsewhere', () => {
      const root: GroupNode = {
        id: 'g', kind: 'group', dir: 'row', ratio: 0.5,
        children: [pane('p1', 'draft'), pane('p2', 'memory')],
      };
      // Adding draft anywhere except p1 conflicts with the existing p1.
      expect(findSingletonConflict(root, 'draft', undefined, 'p2')).toBe('p1');
    });

    it('returns null for terminal panes with different instanceKeys', () => {
      const root: LayoutNode = pane('p1', 'terminal', 'backendA::projA');
      // Adding a terminal for a different project scope is allowed.
      expect(
        findSingletonConflict(root, 'terminal', 'backendA::projB', 'p1'),
      ).toBeNull();
    });

    it('returns the conflicting pane id for terminal panes with the same instanceKey', () => {
      const root: LayoutNode = pane('p1', 'terminal', 'backendA::projA');
      // Same project+backend would mirror one PTY → conflict.
      expect(
        findSingletonConflict(root, 'terminal', 'backendA::projA', 'pX'),
      ).toBe('p1');
    });

    it('walks nested groups', () => {
      const root: GroupNode = {
        id: 'g1', kind: 'group', dir: 'row', ratio: 0.5,
        children: [
          pane('p1', 'terminal', 'b1::pA'),
          {
            id: 'g2', kind: 'group', dir: 'col', ratio: 0.5,
            children: [pane('p2', 'memory'), pane('p3', 'draft')],
          },
        ],
      };
      // draft already at p3 → adding draft conflicts with p3.
      expect(findSingletonConflict(root, 'draft', undefined, 'p1')).toBe('p3');
      // terminal for new scope → no conflict.
      expect(findSingletonConflict(root, 'terminal', 'b2::pB', 'p2')).toBeNull();
    });
  });
});
