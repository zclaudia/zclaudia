import Database from 'better-sqlite3';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ASSET_TYPES, DesignService, isDesignAssetKind } from '../design-service.js';

describe('DesignService video assets (P6 §5.3)', () => {
  let db: Database.Database;
  let temp: string;
  let rootA: string;
  let service: DesignService;

  beforeEach(async () => {
    temp = await mkdtemp(path.join(os.tmpdir(), 'design-service-'));
    rootA = path.join(temp, 'a');
    await mkdir(rootA);
    db = new Database(':memory:');
    db.exec(`CREATE TABLE projects (id TEXT PRIMARY KEY, root_path TEXT);
      CREATE TABLE sessions (id TEXT PRIMARY KEY, project_id TEXT, working_directory TEXT);
      INSERT INTO projects VALUES ('pa', '${rootA}');
      INSERT INTO sessions VALUES ('sa', 'pa', NULL);`);
    service = new DesignService(db);
  });

  afterEach(async () => {
    db.close();
    await rm(temp, { recursive: true, force: true });
  });

  async function seedMixedAssets(): Promise<void> {
    await mkdir(path.join(rootA, 'media'), { recursive: true });
    await writeFile(path.join(rootA, 'media', 'clip.mp4'), Buffer.from([1, 2, 3]));
    await writeFile(path.join(rootA, 'media', 'clip.WEBM'), Buffer.from([4, 5]));
    await writeFile(path.join(rootA, 'movie.mov'), Buffer.from([6]));
    await writeFile(path.join(rootA, 'media', 'photo.png'), Buffer.from([7]));
    await writeFile(path.join(rootA, 'media', 'font.woff2'), Buffer.from([8]));
    await writeFile(path.join(rootA, 'page.html'), '<p>doc</p>');
    await writeFile(path.join(rootA, 'media', 'audio.mp3'), Buffer.from([9]));
    await writeFile(path.join(rootA, 'media', 'clip.mp4.txt'), Buffer.from([10]));
  }

  it("listAssets kinds='video' returns only .mp4/.webm/.mov (case-insensitive), sorted", async () => {
    await seedMixedAssets();
    const { files } = await service.listAssets('sa', 'video');
    expect(files).toEqual(['media/clip.mp4', 'media/clip.WEBM', 'movie.mov']);
  });

  it("listAssets kinds='all' unions image, font and video; 'video' passes isDesignAssetKind", async () => {
    await seedMixedAssets();
    const { files } = await service.listAssets('sa', 'all');
    expect(files).toEqual([
      'media/clip.mp4',
      'media/clip.WEBM',
      'media/font.woff2',
      'media/photo.png',
      'movie.mov',
    ]);
    expect(isDesignAssetKind('video')).toBe(true);
    expect(isDesignAssetKind('image')).toBe(true);
    expect(isDesignAssetKind('all')).toBe(true);
    expect(isDesignAssetKind('audio')).toBe(false);
    await expect(service.listAssets('sa', 'audio')).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
    });
  });

  it('ASSET_TYPES maps video extensions to their mime types', () => {
    expect(ASSET_TYPES['.mp4']).toBe('video/mp4');
    expect(ASSET_TYPES['.webm']).toBe('video/webm');
    expect(ASSET_TYPES['.mov']).toBe('video/quicktime');
  });

  it('readAsset serves small video files with their video mime', async () => {
    await seedMixedAssets();
    const mp4 = await service.readAsset('sa', 'media/clip.mp4');
    expect(mp4.mimeType).toBe('video/mp4');
    expect(Buffer.from(mp4.data, 'base64')).toEqual(Buffer.from([1, 2, 3]));
    const webm = await service.readAsset('sa', 'media/clip.WEBM');
    expect(webm.mimeType).toBe('video/webm');
    const mov = await service.readAsset('sa', 'movie.mov');
    expect(mov.mimeType).toBe('video/quicktime');
  });

  it('still rejects video imports: IMPORTABLE_EXTENSIONS stays image ∪ font', async () => {
    await expect(
      service.importAsset('sa', 'clip.mp4', Buffer.from([1]).toString('base64'))
    ).rejects.toMatchObject({ status: 400, code: 'ASSET_INVALID' });
  });
});
