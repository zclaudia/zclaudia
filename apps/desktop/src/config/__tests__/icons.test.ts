import { describe, it, expect } from 'vitest';
import { ICONS, getToolIcon, getStatusIcon } from '../icons';

describe('icons config', () => {
  describe('ICONS object', () => {
    it('has tool icons', () => {
      expect(ICONS.tools.Read).toBeDefined();
      expect(ICONS.tools.Write).toBeDefined();
      expect(ICONS.tools.Edit).toBeDefined();
      expect(ICONS.tools.Bash).toBeDefined();
      expect(ICONS.tools.default).toBeDefined();
    });

    it('has status icons', () => {
      expect(ICONS.status.loading).toBeDefined();
      expect(ICONS.status.success).toBeDefined();
      expect(ICONS.status.error).toBeDefined();
      expect(ICONS.status.warning).toBeDefined();
      expect(ICONS.status.info).toBeDefined();
    });

    it('has message icons', () => {
      expect(ICONS.message.assistant).toBeDefined();
      expect(ICONS.message.user).toBeDefined();
      expect(ICONS.message.system).toBeDefined();
    });

    it('has system info icons', () => {
      expect(ICONS.systemInfo).toBeDefined();
    });
  });

  describe('getToolIcon', () => {
    it('returns icon for known tool', () => {
      expect(getToolIcon('Read')).toBe(ICONS.tools.Read);
      expect(getToolIcon('Write')).toBe(ICONS.tools.Write);
      expect(getToolIcon('Bash')).toBe(ICONS.tools.Bash);
    });

    it('returns default icon for unknown tool', () => {
      expect(getToolIcon('UnknownTool')).toBe(ICONS.tools.default);
    });
  });

  describe('getStatusIcon', () => {
    it('returns icon for known status', () => {
      expect(getStatusIcon('success')).toBe(ICONS.status.success);
      expect(getStatusIcon('error')).toBe(ICONS.status.error);
      expect(getStatusIcon('loading')).toBe(ICONS.status.loading);
    });

    it('returns info icon for unknown status', () => {
      expect(getStatusIcon('unknown')).toBe(ICONS.status.info);
    });
  });
});
