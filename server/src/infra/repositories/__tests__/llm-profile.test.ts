import { describe, it, expect, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { LlmProfileRepository } from '../../../domains/llm-profiles/index.js';
import { applyMigrations } from '../../storage/migrations/index.js';

describe('LlmProfileRepository', () => {
  let mockDb: any;
  let repository: LlmProfileRepository;

  beforeEach(() => {
    vi.clearAllMocks();

    mockDb = {
      prepare: vi.fn().mockReturnValue({
        all: vi.fn(),
        get: vi.fn(),
        run: vi.fn(),
      }),
    };

    repository = new LlmProfileRepository(mockDb);
  });

  describe('mapRow', () => {
    it('maps database row to LlmProfileConfig entity with all fields', () => {
      const row = {
        id: 'prov-123',
        name: 'Test Provider',
        provider_type: 'anthropic',
        base_url: null,
        api_key: null,
        compat: null,
        request_headers: '{"X-Test-Header":"test-value"}',
        is_default: 1,
        created_at: 1000,
        updated_at: 2000,
      };

      const result = repository.mapRow(row);

      expect(result).toEqual({
        id: 'prov-123',
        name: 'Test Provider',
        providerType: 'anthropic',
        baseUrl: undefined,
        apiKey: undefined,
        compat: undefined,
        requestHeaders: { 'X-Test-Header': 'test-value' },
        isDefault: true,
        recordStatus: {
          completeness: 'draft',
          availability: { usable: false, reason: 'no_credential' },
        },
        createdAt: 1000,
        updatedAt: 2000,
      });
    });

    it('computes recordStatus ready+usable for a profile with a model and an api key', () => {
      const result = repository.mapRow({
        id: 'p2',
        name: 'Ready',
        provider_type: 'anthropic',
        api_key: 'sk-live',
        models: JSON.stringify([{ modelId: 'claude-x' }]),
        is_default: 0,
        created_at: 1,
        updated_at: 2,
      });
      expect(result.recordStatus).toEqual({
        completeness: 'ready',
        availability: { usable: true },
      });
    });

    it('handles null values correctly', () => {
      const row = {
        id: 'prov-123',
        name: 'Test Provider',
        provider_type: 'anthropic',
        base_url: null,
        api_key: null,
        compat: null,
        request_headers: null,
        is_default: 0,
        created_at: 1000,
        updated_at: 2000,
      };

      const result = repository.mapRow(row);

      expect(result.baseUrl).toBeUndefined();
      expect(result.apiKey).toBeUndefined();
      expect(result.compat).toBeUndefined();
      expect(result.requestHeaders).toBeUndefined();
      expect(result.isDefault).toBe(false);
    });

    it('parses requestHeaders JSON correctly', () => {
      const row = {
        id: 'prov-123',
        name: 'Provider',
        provider_type: 'anthropic',
        base_url: null,
        api_key: null,
        compat: null,
        request_headers: '{"X-Header-1":"value1","X-Header-2":"value2"}',
        is_default: 0,
        created_at: 1000,
        updated_at: 2000,
      };

      const result = repository.mapRow(row);

      expect(result.requestHeaders).toEqual({
        'X-Header-1': 'value1',
        'X-Header-2': 'value2',
      });
    });
  });

  describe('createQuery', () => {
    it('generates INSERT query with all fields', () => {
      const data = {
        name: 'New Provider',
        providerType: 'anthropic',
        requestHeaders: { 'X-Api-Key': 'test' },
        isDefault: true,
      };

      const { sql, params } = repository.createQuery(data);

      expect(sql).toContain('INSERT INTO llm_profiles');
      expect(params[1]).toBe('New Provider');
      expect(params[2]).toBe('anthropic');
      // base_url, api_key, compat are nullable and come before request_headers
      expect(params[6]).toBe('{"X-Api-Key":"test"}');
      // models is the 8th param (index 7) — null when omitted
      expect(params[7]).toBeNull();
      // oauth_credentials is the 9th param (index 8) — null when omitted
      expect(params[8]).toBeNull();
      // cache_retention is the 10th param (index 9) — null when omitted
      expect(params[9]).toBeNull();
      // is_default is the 11th param (index 10)
      expect(params[10]).toBe(1);
    });

    it('uses default provider type when not specified', () => {
      const data = {
        name: 'Default Type',
      } as any;

      const { params } = repository.createQuery(data);

      expect(params[2]).toBe('anthropic');
    });

    it('converts isDefault to integer', () => {
      const dataTrue = { name: 'Test', isDefault: true } as any;
      const dataFalse = { name: 'Test', isDefault: false } as any;

      const { params: paramsTrue } = repository.createQuery(dataTrue);
      const { params: paramsFalse } = repository.createQuery(dataFalse);

      expect(paramsTrue[10]).toBe(1);
      expect(paramsFalse[10]).toBe(0);
    });

    it('generates UUID for id', () => {
      const data = { name: 'UUID Test' } as any;
      const { params } = repository.createQuery(data);

      expect(params[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    it('sets timestamps correctly', () => {
      const before = Date.now();
      const data = { name: 'Timestamps' } as any;
      const { params } = repository.createQuery(data);
      const after = Date.now();

      expect(params[11]).toBeGreaterThanOrEqual(before);
      expect(params[11]).toBeLessThanOrEqual(after);
      expect(params[12]).toBe(params[11]);
    });
  });

  describe('updateQuery', () => {
    it('generates UPDATE query for single field', () => {
      const { sql, params } = repository.updateQuery('prov-123', { name: 'Updated Name' });

      expect(sql).toContain('UPDATE llm_profiles SET');
      expect(sql).toContain('name = ?');
      expect(sql).toContain('updated_at = ?');
      expect(params).toContain('Updated Name');
      expect(params[params.length - 1]).toBe('prov-123');
    });

    it('generates UPDATE query for multiple fields', () => {
      const { sql, params } = repository.updateQuery('prov-123', {
        name: 'New Name',
        providerType: 'openai',
      });

      expect(sql).toContain('name = ?');
      expect(sql).toContain('provider_type = ?');
      expect(params).toContain('New Name');
      expect(params).toContain('openai');
    });

    it('handles requestHeaders JSON serialization', () => {
      const { sql, params } = repository.updateQuery('prov-123', {
        requestHeaders: { 'X-New-Header': 'new-value' },
      });

      expect(sql).toContain('request_headers = ?');
      expect(params).toContain('{"X-New-Header":"new-value"}');
    });

    it('handles null requestHeaders', () => {
      const { params } = repository.updateQuery('prov-123', {
        requestHeaders: null as any,
      });

      expect(params).toContain(null);
    });

    it('converts isDefault to integer', () => {
      const { params } = repository.updateQuery('prov-123', {
        isDefault: true,
      });

      expect(params).toContain(1);
    });

    it('always updates updated_at timestamp', () => {
      const before = Date.now();
      const { params } = repository.updateQuery('prov-123', { name: 'Test' });
      const after = Date.now();

      const timestamp = params[params.length - 2];
      expect(timestamp).toBeGreaterThanOrEqual(before);
      expect(timestamp).toBeLessThanOrEqual(after);
    });
  });

  describe('oauthCredentials', () => {
    it('mapRow parses oauth_credentials JSON', () => {
      const row = {
        id: 'p1',
        name: 'codex',
        provider_type: 'openai-codex',
        base_url: null,
        api_key: null,
        compat: null,
        request_headers: null,
        models: null,
        oauth_credentials: '{"access":"a","refresh":"r","expires":1,"accountId":"acct_x"}',
        is_default: 0,
        created_at: 1,
        updated_at: 1,
      };

      const result = repository.mapRow(row);
      expect(result.oauthCredentials).toEqual({
        access: 'a',
        refresh: 'r',
        expires: 1,
        accountId: 'acct_x',
      });
    });

    it('mapRow yields undefined when oauth_credentials is null', () => {
      const row = {
        id: 'p1',
        name: 'codex',
        provider_type: 'openai-codex',
        base_url: null,
        api_key: null,
        compat: null,
        request_headers: null,
        models: null,
        oauth_credentials: null,
        is_default: 0,
        created_at: 1,
        updated_at: 1,
      };
      const result = repository.mapRow(row);
      expect(result.oauthCredentials).toBeUndefined();
    });

    it('createQuery serializes oauthCredentials', () => {
      const { sql, params } = repository.createQuery({
        name: 'codex',
        providerType: 'openai-codex',
        oauthCredentials: { access: 'a', refresh: 'r', expires: 1, accountId: 'acct_x' },
      } as any);
      expect(sql).toContain('oauth_credentials');
      expect(params).toContain('{"access":"a","refresh":"r","expires":1,"accountId":"acct_x"}');
    });

    it('updateQuery supports clearing oauthCredentials via null', () => {
      const { sql, params } = repository.updateQuery('p1', { oauthCredentials: undefined } as any);
      // undefined means "don't touch"; null is the explicit clear path
      expect(sql).not.toContain('oauth_credentials');
      // Now test the explicit clear path:
      const cleared = repository.updateQuery('p1', { oauthCredentials: null } as any);
      expect(cleared.sql).toContain('oauth_credentials = ?');
      expect(cleared.params[0]).toBeNull();
    });
  });

  describe('findDefault', () => {
    it('returns default provider when found', () => {
      const mockRow = {
        id: 'prov-123',
        name: 'Default Provider',
        provider_type: 'anthropic',
        base_url: null,
        api_key: null,
        compat: null,
        is_default: 1,
        created_at: 1000,
        updated_at: 2000,
      };
      mockDb.prepare().get.mockReturnValue(mockRow);

      const result = repository.findDefault();

      expect(result).not.toBeNull();
      expect(result?.id).toBe('prov-123');
      expect(result?.isDefault).toBe(true);
      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('WHERE is_default = 1'));
    });

    it('returns null when no default provider exists', () => {
      mockDb.prepare().get.mockReturnValue(undefined);

      const result = repository.findDefault();

      expect(result).toBeNull();
    });
  });

  describe('setDefault', () => {
    it('unsets all defaults and sets specified provider as default', () => {
      const mockRow = {
        id: 'prov-123',
        name: 'Test Provider',
        provider_type: 'anthropic',
        base_url: null,
        api_key: null,
        compat: null,
        is_default: 1,
        created_at: 1000,
        updated_at: 2000,
      };

      mockDb.prepare().run.mockReturnValue({ changes: 1 });
      mockDb.prepare().get.mockReturnValue(mockRow);

      const result = repository.setDefault('prov-123');

      expect(result.isDefault).toBe(true);
      expect(mockDb.prepare).toHaveBeenCalledWith('UPDATE llm_profiles SET is_default = 0');
    });

    it('throws error if provider not found', () => {
      mockDb.prepare().run.mockReturnValueOnce({ changes: 0 });
      mockDb.prepare().run.mockReturnValueOnce({ changes: 0 });

      expect(() => {
        repository.setDefault('non-existent');
      }).toThrow('LlmProfile not found: non-existent');
    });

    it('throws error if update fails', () => {
      mockDb.prepare().run.mockReturnValueOnce({ changes: 0 });
      mockDb.prepare().run.mockReturnValueOnce({ changes: 1 });
      mockDb.prepare().get.mockReturnValue(undefined);

      expect(() => {
        repository.setDefault('prov-123');
      }).toThrow('Failed to set default llm profile: prov-123');
    });
  });
});

describe('LlmProfileRepository — new fields (baseUrl / apiKey / compat)', () => {
  let db: Database.Database;
  let repo: LlmProfileRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    applyMigrations(db);
    repo = new LlmProfileRepository(db);
  });

  it('persists baseUrl + apiKey + compat fields', () => {
    const created = repo.create({
      name: 'deepseek-local',
      providerType: 'openai',
      baseUrl: 'http://127.0.0.1:3000/v1',
      apiKey: 'sk-test',
      compat: { supportsDeveloperRole: false, supportsReasoningEffort: false },
    });
    const fetched = repo.findById(created.id);
    expect(fetched).toBeDefined();
    expect(fetched!.baseUrl).toBe('http://127.0.0.1:3000/v1');
    expect(fetched!.apiKey).toBe('sk-test');
    expect(fetched!.compat).toEqual({
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
    });
  });

  it('handles compat as undefined when not provided', () => {
    const created = repo.create({
      name: 'anthropic',
      providerType: 'anthropic',
      apiKey: 'sk-ant-test',
    });
    const fetched = repo.findById(created.id);
    expect(fetched!.compat).toBeUndefined();
  });

  it('updates baseUrl / apiKey / compat partially', () => {
    const created = repo.create({
      name: 'p1',
      providerType: 'openai',
      apiKey: 'sk-old',
    });
    const updated = repo.update(created.id, {
      apiKey: 'sk-new',
      compat: { supportsStrictMode: true },
    });
    expect(updated!.apiKey).toBe('sk-new');
    expect(updated!.compat).toEqual({ supportsStrictMode: true });
  });

  it('returns undefined compat when DB JSON is malformed (graceful degradation)', () => {
    const created = repo.create({ name: 'p2', providerType: 'anthropic' });
    // Manually corrupt the compat column
    db.prepare('UPDATE llm_profiles SET compat = ? WHERE id = ?').run('{broken', created.id);
    const fetched = repo.findById(created.id);
    expect(fetched).toBeDefined();
    expect(fetched!.compat).toBeUndefined();
  });

  it('findDefault returns is_default=1 record', () => {
    repo.create({ name: 'a', providerType: 'anthropic' });
    const b = repo.create({ name: 'b', providerType: 'openai', isDefault: true });
    const def = repo.findDefault();
    expect(def?.id).toBe(b.id);
  });

  it('setDefault clears previous default', () => {
    const a = repo.create({ name: 'a', providerType: 'anthropic', isDefault: true });
    const b = repo.create({ name: 'b', providerType: 'openai' });
    repo.setDefault(b.id);
    expect(repo.findById(a.id)!.isDefault).toBe(false);
    expect(repo.findById(b.id)!.isDefault).toBe(true);
  });

  it('round-trips requestHeaders through create + findById', () => {
    const created = repo.create({
      name: 'with-headers',
      providerType: 'openai',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-test',
      requestHeaders: { 'X-Org-Id': 'abc', 'X-Trace': 'xyz' },
    });
    const found = repo.findById(created.id);
    expect(found?.requestHeaders).toEqual({ 'X-Org-Id': 'abc', 'X-Trace': 'xyz' });
  });

  it('update can clear requestHeaders by passing null', () => {
    const created = repo.create({
      name: 'h2',
      providerType: 'openai',
      requestHeaders: { 'X-Foo': 'bar' },
    });
    repo.update(created.id, { requestHeaders: undefined }); // undefined = no change
    repo.update(created.id, { requestHeaders: null as any }); // null = clear
    const found = repo.findById(created.id);
    expect(found?.requestHeaders).toBeUndefined();
  });
});
