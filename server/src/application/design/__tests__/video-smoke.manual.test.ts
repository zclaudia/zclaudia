// P6.4 真实视频渲染冒烟（手工门槛，不进常规 CI）：ZCLAUDIA_MEDIA_SMOKE=1 时运行。
// 依赖本机 Chrome（chrome-discovery WELL_KNOWN 发现）与 ffmpeg（resolveFfmpegPath）；
// CSS 动画页 → screencast → libx264 MP4，产物用 ffprobe 校验容器与时长。
// 运行：ZCLAUDIA_MEDIA_SMOKE=1 pnpm --filter @zclaudia/server exec vitest run src/application/design/__tests__/video-smoke.manual.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import Database from 'better-sqlite3';
import { DesignService } from '../design-service.js';
import {
  MediaTaskService,
  createGeneratedAssetWriter,
} from '../media-task-service.js';
import { createVideoRenderExecutor, defaultVideoRenderDeps } from '../video-render-service.js';
import { migration } from '../../../infra/storage/migrations/051_design_media_tasks.js';

const RUN_SMOKE = process.env.ZCLAUDIA_MEDIA_SMOKE === '1';

const ANIMATED_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  @keyframes slide {
    from { transform: translateX(0); background: #e11d48; }
    to { transform: translateX(360px); background: #2563eb; }
  }
  .box {
    width: 180px;
    height: 180px;
    border-radius: 24px;
    animation: slide 1.6s linear infinite alternate;
  }
  body { margin: 0; background: #f8fafc; }
</style>
</head>
<body><div class="box"></div></body>
</html>`;

function ffprobeJson(file: string): Promise<{ format?: { format_name?: string; duration?: string } }> {
  return new Promise((resolve, reject) => {
    const child = spawn('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=format_name,duration',
      '-of', 'json',
      file,
    ]);
    let out = '';
    child.stdout.on('data', chunk => (out += chunk));
    child.once('error', reject);
    child.once('close', code => {
      if (code !== 0) return reject(new Error(`ffprobe 退出码 ${code}`));
      try {
        resolve(JSON.parse(out));
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  });
}

describe('P6 真实视频渲染冒烟（ZCLAUDIA_MEDIA_SMOKE=1）', () => {
  let temp: string;
  let prevDataDir: string | undefined;
  let db: Database.Database;

  beforeAll(async () => {
    temp = await fs.mkdtemp(path.join(os.tmpdir(), 'p6-video-smoke-'));
    // 数据目录指向临时位置：浏览器 engine cache 与真实 ~/.zclaudia 隔离
    //（Chrome 走 WELL_KNOWN 应用路径发现，无需下载 engine）。
    prevDataDir = process.env.ZCLAUDIA_DATA_DIR;
    process.env.ZCLAUDIA_DATA_DIR = path.join(temp, 'data');
    db = new Database(':memory:');
    db.exec('CREATE TABLE projects (id TEXT PRIMARY KEY, root_path TEXT NOT NULL)');
    db.exec(
      'CREATE TABLE sessions (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, working_directory TEXT)'
    );
    db.prepare('INSERT INTO projects VALUES (?, ?)').run('p1', temp);
    db.prepare('INSERT INTO sessions VALUES (?, ?, NULL)').run('sa', 'p1');
    db.exec(migration.sql);
  });

  afterAll(async () => {
    if (prevDataDir === undefined) delete process.env.ZCLAUDIA_DATA_DIR;
    else process.env.ZCLAUDIA_DATA_DIR = prevDataDir;
    db?.close();
    if (temp) await fs.rm(temp, { recursive: true, force: true });
  });

  (RUN_SMOKE ? it : it.skip)(
    '渲染 2 秒 CSS 动画页为可播放 MP4',
    { timeout: 120_000 },
    async () => {
      const entryRel = 'design/anim/index.html';
      await fs.mkdir(path.join(temp, 'design/anim'), { recursive: true });
      await fs.writeFile(path.join(temp, entryRel), ANIMATED_HTML, 'utf8');

      const service = new DesignService(db);
      const media = new MediaTaskService(db, service, {
        'video-render': createVideoRenderExecutor({
          ...defaultVideoRenderDeps(),
          saveOutput: (sessionId, bytes) =>
            createGeneratedAssetWriter(service, sessionId)('smoke.mp4', bytes, 'video/mp4'),
        }),
      });

      const created = await media.create('sa', {
        kind: 'video-render',
        entryPath: entryRel,
        width: 640,
        height: 360,
        fps: 24,
        durationMs: 2000,
      });
      expect(created.status).toMatch(/queued|running/);

      // 轮询至终态（真实 Chrome 启动 + 2s 采集 + 编码，上限 90s）。
      let terminal: Awaited<ReturnType<typeof media.list>>[number] | undefined;
      const deadline = Date.now() + 90_000;
      while (Date.now() < deadline) {
        const tasks = await media.list('sa');
        terminal = tasks.find(task => task.id === created.id);
        if (terminal && !['queued', 'running'].includes(terminal.status)) break;
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      expect(terminal).toBeDefined();
      expect(terminal?.error?.message ?? '').toBe('');
      expect(terminal?.status).toBe('completed');
      expect(terminal?.result?.path).toMatch(/\.mp4$/);

      const absolute = path.join(temp, terminal!.result!.path);
      const bytes = await fs.readFile(absolute);
      expect(bytes.length).toBeGreaterThan(10_000);
      // ftyp 盒（ISO BMFF / MP4 家族）。
      expect(bytes.subarray(4, 8).toString('latin1')).toBe('ftyp');

      const probe = await ffprobeJson(absolute);
      expect(probe.format?.format_name).toContain('mp4');
      const duration = Number(probe.format?.duration ?? '0');
      expect(duration).toBeGreaterThanOrEqual(1.0);
      expect(duration).toBeLessThanOrEqual(3.5);
    }
  );
});
