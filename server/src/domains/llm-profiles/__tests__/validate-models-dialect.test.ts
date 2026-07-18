import { describe, expect, it } from 'vitest';
import { validateModels } from '../routes.js';

describe('validateModels — dialect', () => {
  it('accepts a known dialect and preserves it', () => {
    const out = validateModels([{ modelId: 'kimi-k2', dialect: 'moonshotai' }]);
    expect(out).toEqual([{ modelId: 'kimi-k2', dialect: 'moonshotai' }]);
  });

  it('omits dialect when absent or null', () => {
    expect(validateModels([{ modelId: 'a' }])).toEqual([{ modelId: 'a' }]);
    expect(validateModels([{ modelId: 'a', dialect: null }])).toEqual([{ modelId: 'a' }]);
  });

  it('rejects unknown dialect values', () => {
    expect(() => validateModels([{ modelId: 'a', dialect: 'kimi' }])).toThrow(
      /models\[0\]\.dialect/
    );
    expect(() => validateModels([{ modelId: 'a', dialect: 42 }])).toThrow(/models\[0\]\.dialect/);
  });
});
