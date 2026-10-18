import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { applyMigrations } from '../../infra/storage/migrations/index.js';
import {
  getAutoTitleConfig,
  getAutoTitleConfigView,
  updateAutoTitleConfig,
} from '../auto-title-config.js';

describe('auto-title-config', () => {
  it('falls back to enabled defaults when the table does not exist yet', () => {
    const db = new Database(':memory:');
    expect(getAutoTitleConfig(db)).toEqual({ enabled: true, model: null });
  });

  it('seeds an enabled row with no model after migrations', () => {
    const db = new Database(':memory:');
    applyMigrations(db);
    expect(getAutoTitleConfigView(db)).toMatchObject({ enabled: true, model: null });
  });

  it('applies partial updates independently', () => {
    const db = new Database(':memory:');
    applyMigrations(db);

    expect(updateAutoTitleConfig(db, { enabled: false })).toMatchObject({
      enabled: false,
      model: null,
    });
    expect(updateAutoTitleConfig(db, { model: 'gpt-mini' })).toMatchObject({
      enabled: false,
      model: 'gpt-mini',
    });
    // Empty/whitespace strings clear the model; null does too.
    expect(updateAutoTitleConfig(db, { model: '   ' }).model).toBeNull();
    expect(updateAutoTitleConfig(db, { model: 'x' }).model).toBe('x');
    expect(updateAutoTitleConfig(db, { model: null }).model).toBeNull();
    // Unspecified keys keep their stored value.
    expect(getAutoTitleConfigView(db)).toMatchObject({ enabled: false, model: null });
  });
});
