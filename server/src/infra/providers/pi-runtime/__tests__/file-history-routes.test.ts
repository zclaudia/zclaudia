import express from 'express';
import request from 'supertest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import { describe, expect, it } from 'vitest';
import { recordFileBackup } from '../file-history.js';
import { createFileHistoryRoutes } from '../file-history-routes.js';

describe('file history routes', () => {
  it('restores a file from a recorded backup id', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zc-history-'));
    const filePath = path.join(dir, 'f.ts');
    writeFileSync(filePath, 'const a = 1;\n');
    const backup = await recordFileBackup('f.ts', 'const a = 1;\n', filePath);
    writeFileSync(filePath, 'const a = 2;\n');
    const app = express();
    app.use(express.json());
    app.use('/api/providers', createFileHistoryRoutes());

    const res = await request(app)
      .post(`/api/providers/file-history/backups/${backup.id}/restore`)
      .send({});
    const restored = readFileSync(filePath, 'utf8');

    rmSync(dir, { recursive: true, force: true });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      data: { id: backup.id, originalPath: 'f.ts', restored: true },
    });
    expect(restored).toBe('const a = 1;\n');
  });
});
