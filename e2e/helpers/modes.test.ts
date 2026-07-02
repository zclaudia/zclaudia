import { afterEach, describe, expect, test } from 'vitest';
import { getEnabledModes, getMode, parseRequestedModeIds } from './modes';

describe('E2E mode selection', () => {
  const originalTestModes = process.env.TEST_MODES;

  afterEach(() => {
    if (originalTestModes === undefined) {
      delete process.env.TEST_MODES;
      return;
    }
    process.env.TEST_MODES = originalTestModes;
  });

  test('parses comma-separated TEST_MODES values', () => {
    expect(parseRequestedModeIds('local,gateway')).toEqual(new Set(['local', 'gateway']));
    expect(parseRequestedModeIds(' local , remote , ')).toEqual(new Set(['local', 'remote']));
    expect(parseRequestedModeIds(undefined)).toBeNull();
  });

  test('filters enabled modes from TEST_MODES without mutating mode definitions', () => {
    process.env.TEST_MODES = 'local';

    expect(getEnabledModes().map(mode => mode.id)).toEqual(['local']);
    expect(getMode('local').enabled).toBe(true);
    expect(getMode('gateway').enabled).toBe(false);
  });
});
