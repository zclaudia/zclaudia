import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { ensureSchemaIsCurrent } from '../db.js';
import { applyMigrations } from '../migrations/index.js';

describe('ensureSchemaIsCurrent', () => {
  it('throws clear error when legacy providers table exists but llm_profiles is missing', () => {
    const db = new Database(':memory:');
    // Simulate an old DB: only the legacy `providers` table, no `llm_profiles`.
    db.exec(`CREATE TABLE providers (id TEXT)`);

    expect(() => ensureSchemaIsCurrent(db)).toThrow(/Schema mismatch.*providers.*llm_profiles/s);

    db.close();
  });

  it('passes when both tables exist (e.g. in-flight rename window)', () => {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE providers (id TEXT)`);
    db.exec(`CREATE TABLE llm_profiles (id TEXT)`);
    db.exec(`CREATE TABLE agent_profiles (id TEXT)`);

    expect(() => ensureSchemaIsCurrent(db)).not.toThrow();

    db.close();
  });

  it('passes on a freshly migrated DB (only llm_profiles exists)', () => {
    const db = new Database(':memory:');
    applyMigrations(db); // creates llm_profiles, no legacy providers table

    expect(() => ensureSchemaIsCurrent(db)).not.toThrow();

    db.close();
  });

  it('throws clear error when llm_profiles exists but agent_profiles missing', () => {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE llm_profiles (id TEXT)`);

    expect(() => ensureSchemaIsCurrent(db)).toThrow(/Schema mismatch.*agent_profiles/s);

    db.close();
  });

  it('throws clear error when sessions has llm_profile_id but missing agent_profile_id', () => {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE llm_profiles (id TEXT)`);
    db.exec(`CREATE TABLE agent_profiles (id TEXT)`);
    db.exec(`CREATE TABLE sessions (id TEXT, llm_profile_id TEXT)`);

    expect(() => ensureSchemaIsCurrent(db)).toThrow(/sessions\.llm_profile_id.*agent_profile_id/s);

    db.close();
  });

  it('throws clear error when projects has llm_profile_id but missing default_agent_profile_id', () => {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE llm_profiles (id TEXT)`);
    db.exec(`CREATE TABLE agent_profiles (id TEXT)`);
    db.exec(`CREATE TABLE sessions (id TEXT, agent_profile_id TEXT)`);
    db.exec(`CREATE TABLE projects (id TEXT, llm_profile_id TEXT)`);

    expect(() => ensureSchemaIsCurrent(db)).toThrow(
      /projects\.llm_profile_id.*default_agent_profile_id/s
    );

    db.close();
  });
});
