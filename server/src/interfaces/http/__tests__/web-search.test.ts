import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';
import { createWebSearchConfigRoutes } from '../web-search.js';

describe('Web Search config routes', () => {
  let app: express.Application;
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE web_search_config (
        id INTEGER PRIMARY KEY CHECK(id = 1),
        brave_api_key TEXT,
        searxng_base_url TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      INSERT INTO web_search_config (id, created_at, updated_at) VALUES (1, 1000, 1000);
    `);
    app = express();
    app.use(express.json());
    app.use('/api/web-search', createWebSearchConfigRoutes(db));
  });

  afterEach(() => {
    db.close();
    vi.unstubAllEnvs();
  });

  it('returns env-backed config without exposing the Brave key', async () => {
    vi.stubEnv('ZCLAUDIA_BRAVE_SEARCH_API_KEY', 'brave-secret');
    vi.stubEnv('ZCLAUDIA_SEARXNG_BASE_URL', 'https://search.example.com');

    const response = await request(app).get('/api/web-search/config').expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data).toMatchObject({
      braveApiKey: '********',
      braveApiKeySource: 'env',
      searxngBaseUrl: 'https://search.example.com',
      searxngBaseUrlSource: 'env',
      duckDuckGoFallbackEnabled: true,
    });
  });

  it('stores config and masks the stored Brave key', async () => {
    const response = await request(app)
      .put('/api/web-search/config')
      .send({
        braveApiKey: 'stored-key',
        searxngBaseUrl: 'https://search.example.com/',
      })
      .expect(200);

    expect(response.body.data).toMatchObject({
      braveApiKey: '********',
      braveApiKeySource: 'stored',
      searxngBaseUrl: 'https://search.example.com',
      searxngBaseUrlSource: 'stored',
    });
    const row = db
      .prepare('SELECT brave_api_key, searxng_base_url FROM web_search_config WHERE id = 1')
      .get() as {
      brave_api_key: string;
      searxng_base_url: string;
    };
    expect(row.brave_api_key).toBe('stored-key');
    expect(row.searxng_base_url).toBe('https://search.example.com');
  });

  it('clears stored values without clearing env fallbacks', async () => {
    vi.stubEnv('BRAVE_SEARCH_API_KEY', 'env-key');
    db.prepare(
      'UPDATE web_search_config SET brave_api_key = ?, searxng_base_url = ? WHERE id = 1'
    ).run('stored-key', 'https://stored.example.com');

    const response = await request(app)
      .put('/api/web-search/config')
      .send({ braveApiKey: null, searxngBaseUrl: null })
      .expect(200);

    expect(response.body.data).toMatchObject({
      braveApiKey: '********',
      braveApiKeySource: 'env',
      searxngBaseUrl: null,
      searxngBaseUrlSource: null,
    });
    const row = db
      .prepare('SELECT brave_api_key, searxng_base_url FROM web_search_config WHERE id = 1')
      .get() as {
      brave_api_key: string | null;
      searxng_base_url: string | null;
    };
    expect(row.brave_api_key).toBeNull();
    expect(row.searxng_base_url).toBeNull();
  });

  it('rejects invalid SearXNG URLs', async () => {
    const response = await request(app)
      .put('/api/web-search/config')
      .send({ searxngBaseUrl: 'file:///tmp/search' })
      .expect(400);

    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('WEB_SEARCH_CONFIG_INVALID');
  });
});
