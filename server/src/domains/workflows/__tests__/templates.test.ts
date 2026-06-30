import { describe, it, expect } from 'vitest';
import { BUILTIN_WORKFLOW_TEMPLATES } from '../templates.js';

describe('builtin workflow templates', () => {
  it('no template definition carries a triggers field', () => {
    for (const t of BUILTIN_WORKFLOW_TEMPLATES) {
      expect('triggers' in t.definition).toBe(false);
    }
  });
});
