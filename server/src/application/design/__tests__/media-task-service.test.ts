// L31 媒体任务服务测试：真临时目录 + :memory: SQLite + migration 051；
// 假执行器/假 provider 注入。风格对齐 snapshot-service.test.ts。

import Database from 'better-sqlite3';
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { migration as migration051 } from '../../../infra/storage/migrations/051_design_media_tasks.js';
import { DesignError, DesignService } from '../design-service.js';
import {
  MediaProviderError,
  MediaTaskRunError,
  MEDIA_IMAGE_SOURCE_MAX_BYTES,
  type DesignMediaProviderRef,
  type DesignMediaTaskResult,
  type MediaExecutorContext,
  type MediaImageProvider,
  type MediaImageResult,
  type MediaTaskExecution,
  type MediaTaskExecutor,
} from '../media-types.js';
import {
  MediaTaskService,
  createGeneratedAssetWriter,
  createImageTaskExecutor,
} from '../media-task-service.js';

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const SOURCE_PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 9, 9, 9]);

const IMAGE_RESULT: DesignMediaTaskResult = {
  path: 'design/assets/gen-x.png',
  bytes: 4,
  mime: 'image/png',
  usage: null,
};
const VIDEO_RESULT: DesignMediaTaskResult = {
  path: 'design/assets/render.webm',
  bytes: 9,
  mime: 'video/webm',
  usage: null,
};

function imageInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'image-generate',
    provider: { profileId: 'p1', model: 'cogview-4' },
    prompt: 'a cat',
    ...overrides,
  };
}

function videoInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'video-render',
    entryPath: 'index.html',
    width: 1280,
    height: 720,
    fps: 30,
    durationMs: 2000,
    ...overrides,
  };
}

function providerRef(overrides: Partial<DesignMediaProviderRef> = {}): DesignMediaProviderRef {
  return {
    providerId: 'openai-images',
    profileId: 'p1',
    profileName: 'BigModel',
    model: 'cogview-4',
    ...overrides,
  };
}

interface ExecutorGate {
  execution: MediaTaskExecution;
  ctx: MediaExecutorContext;
  resolve: (result: DesignMediaTaskResult) => void;
  reject: (error: unknown) => void;
}

/** 每次调用产生独立闸门的假执行器：测试手工放行/拒绝并观测 signal。 */
function gatedExecutor(): { executor: MediaTaskExecutor; gates: ExecutorGate[] } {
  const gates: ExecutorGate[] = [];
  const executor: MediaTaskExecutor = (execution, ctx) =>
    new Promise<DesignMediaTaskResult>((resolve, reject) => {
      gates.push({ execution, ctx, resolve, reject });
    });
  return { executor, gates };
}

function testCtx(): MediaExecutorContext {
  return {
    signal: new AbortController().signal,
    onProgress: async () => undefined,
    workspaceRoot: '/tmp/not-a-workspace',
    resolveWorkspacePath: async (relative: string) => path.join('/tmp/not-a-workspace', relative),
  };
}

function fakeProvider(result: MediaImageResult): {
  provider: MediaImageProvider;
  generate: ReturnType<typeof vi.fn>;
  edit: ReturnType<typeof vi.fn>;
} {
  const generate = vi.fn(async () => result);
  const edit = vi.fn(async () => result);
  const provider: MediaImageProvider = {
    info: { id: 'fake-images', label: '假图片服务', capabilities: ['generate', 'edit'] },
    generate: generate as unknown as MediaImageProvider['generate'],
    edit: edit as unknown as MediaImageProvider['edit'],
  };
  return { provider, generate, edit };
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('waitFor: condition not met before timeout');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

describe('MediaTaskService', () => {
  let db: Database.Database;
  let temp: string;
  let rootA: string;
  let storedRootA: string;
  let designService: DesignService;

  beforeEach(async () => {
    temp = await mkdtemp(path.join(os.tmpdir(), 'design-media-'));
    rootA = path.join(temp, 'a');
    const rootB = path.join(temp, 'b');
    await mkdir(rootA);
    await mkdir(rootB);
    db = new Database(':memory:');
    db.exec(`CREATE TABLE projects (id TEXT PRIMARY KEY, root_path TEXT);
      CREATE TABLE sessions (id TEXT PRIMARY KEY, project_id TEXT, working_directory TEXT);
      INSERT INTO projects VALUES ('pa', '${rootA}'), ('pb', '${rootB}');
      INSERT INTO sessions VALUES ('sa', 'pa', NULL), ('sa2', 'pa', NULL), ('sb', 'pb', NULL);`);
    db.exec(migration051.sql);
    designService = new DesignService(db);
    storedRootA = await realpath(rootA);
  });

  afterEach(async () => {
    db.close();
    await rm(temp, { recursive: true, force: true });
  });

  function makeService(
    executors: Record<string, MediaTaskExecutor>,
    deps: { resolveProfileName?: (profileId: string) => string | null } = {}
  ): MediaTaskService {
    return new MediaTaskService(
      db,
      designService,
      executors as ConstructorParameters<typeof MediaTaskService>[2],
      deps
    );
  }

  interface RawTaskRow {
    status: string;
    errorCode: string | null;
    errorMessage: string | null;
    resultJson: string | null;
    progressJson: string | null;
  }

  function rawTask(id: string): RawTaskRow | undefined {
    return db
      .prepare(
        `SELECT status, error_code AS errorCode, error_message AS errorMessage,
                result_json AS resultJson, progress_json AS progressJson
         FROM design_media_tasks WHERE id = ?`
      )
      .get(id) as RawTaskRow | undefined;
  }

  function insertSeedTask(
    id: string,
    status: string,
    options: { workspaceRoot?: string; createdAt?: number; resultJson?: string } = {}
  ): void {
    db.prepare(
      `INSERT INTO design_media_tasks
         (id, workspace_root, session_id, kind, status, params_json, dedup_key, created_at, updated_at, result_json)
       VALUES (?, ?, 'sa', 'image-generate', ?, '{}', ?, ?, ?, ?)`
    ).run(
      id,
      options.workspaceRoot ?? storedRootA,
      status,
      `dedup-${id}`,
      options.createdAt ?? 1,
      options.createdAt ?? 1,
      options.resultJson ?? null
    );
  }

  it('rejects invalid create inputs with MEDIA_VALIDATION messages', async () => {
    const service = makeService({});
    const cases: Array<[Record<string, unknown>, string]> = [
      [{}, 'kind'],
      [{ kind: 'nope' }, 'kind'],
      [imageInput({ prompt: '   ' }), 'prompt'],
      [imageInput({ prompt: 'x'.repeat(4001) }), 'prompt'],
      [imageInput({ size: '1024' }), 'size'],
      [imageInput({ size: 'abcxdef' }), 'size'],
      [imageInput({ provider: undefined }), 'provider'],
      [imageInput({ provider: { profileId: 'p1' } }), 'model'],
      [imageInput({ provider: { model: 'cogview-4' } }), 'profileId'],
      [imageInput({ provider: { profileId: 'p1', model: '   ' } }), 'model'],
      [imageInput({ provider: { profileId: 'p1', model: 'm'.repeat(101) } }), 'model'],
      [{ kind: 'image-edit', provider: providerRef(), prompt: 'x' }, 'sourcePath'],
      [imageInput({ targetDir: '../escape' }), 'targetDir'],
      [videoInput({ entryPath: '' }), 'entryPath'],
      [videoInput({ width: 319 }), 'width'],
      [videoInput({ width: 1281 }), 'even number'],
      [videoInput({ height: 100 }), 'height'],
      [videoInput({ height: 1921 }), 'height'],
      [videoInput({ fps: 7 }), 'fps'],
      [videoInput({ fps: 61 }), 'fps'],
      [videoInput({ durationMs: 499 }), 'durationMs'],
      [videoInput({ durationMs: 60001 }), 'durationMs'],
    ];
    for (const [input, fragment] of cases) {
      const error = (await service.create('sa', input).catch((e: unknown) => e)) as DesignError;
      expect(error, JSON.stringify(input)).toBeInstanceOf(DesignError);
      expect(error.status).toBe(400);
      expect(error.code).toBe('MEDIA_VALIDATION');
      expect(error.message).toContain(fragment);
    }
    await expect(service.create('absent', imageInput())).rejects.toMatchObject({
      status: 404,
      code: 'SESSION_NOT_FOUND',
    });
  });

  it('rejects unknown profiles via resolveProfileName and snapshots the profile name', async () => {
    const missing = makeService({});
    await expect(missing.create('sa', imageInput())).rejects.toMatchObject({
      status: 400,
      code: 'MEDIA_VALIDATION',
      message: 'The specified service profile does not exist',
    });

    const { executor, gates } = gatedExecutor();
    const service = makeService(
      { 'image-generate': executor },
      { resolveProfileName: id => (id === 'p1' ? 'BigModel' : null) }
    );
    const summary = await service.create('sa', imageInput({ size: '1024x1024' }));
    expect(summary.status).toBe('running');
    expect(summary.provider).toEqual(providerRef());
    expect(gates[0].execution.provider).toEqual(providerRef());

    await expect(
      service.create('sa', imageInput({ provider: { profileId: 'absent', model: 'm' } }))
    ).rejects.toMatchObject({ code: 'MEDIA_VALIDATION', message: 'The specified service profile does not exist' });
  });

  it('normalizes params (trim, default targetDir) and stores provider-less video params', async () => {
    const { executor, gates } = gatedExecutor();
    const service = makeService(
      { 'image-generate': executor, 'video-render': executor },
      { resolveProfileName: () => 'BigModel' }
    );
    const image = await service.create('sa', imageInput({ prompt: '  a cat  ' }));
    expect(image.params).toEqual({
      type: 'image-generate',
      prompt: 'a cat',
      targetDir: 'design/assets',
    });
    expect(image.progress).toBeNull();
    expect(image.result).toBeNull();
    expect(image.error).toBeNull();

    const video = await service.create('sa', videoInput({ entryPath: 'pages/index.html' }));
    expect(video.status).toBe('running');
    expect(video.provider).toBeNull();
    expect(video.params).toEqual({
      type: 'video-render',
      entryPath: 'pages/index.html',
      width: 1280,
      height: 720,
      fps: 30,
      durationMs: 2000,
    });
    expect(gates).toHaveLength(2);
    gates[0].resolve(IMAGE_RESULT);
    gates[1].resolve(VIDEO_RESULT);
  });

  it('dedupes identical active tasks per workspace with 409', async () => {
    const { executor, gates } = gatedExecutor();
    const service = makeService({ 'image-generate': executor }, { resolveProfileName: () => 'P' });
    const first = await service.create('sa', imageInput());
    expect(first.status).toBe('running');
    await expect(service.create('sa', imageInput())).rejects.toMatchObject({
      status: 409,
      code: 'MEDIA_TASK_ACTIVE_EXISTS',
      message: 'An identical task is already in progress',
    });
    // 其他工作区不受影响；第一个完成后允许重新提交。
    const other = await service.create('sb', imageInput());
    expect(other.status).toBe('running');
    gates[0].resolve(IMAGE_RESULT);
    await waitFor(() => rawTask(first.id)?.status === 'completed');
    const again = await service.create('sa', imageInput());
    expect(again.status).toBe('running');
    gates[1].resolve(IMAGE_RESULT);
    gates[2].resolve(IMAGE_RESULT);
  });

  it('queues image tasks beyond the concurrency limit of 2 and dispatches on completion', async () => {
    const { executor, gates } = gatedExecutor();
    const service = makeService({ 'image-generate': executor }, { resolveProfileName: () => 'P' });
    const t1 = await service.create('sa', imageInput({ prompt: 'one' }));
    const t2 = await service.create('sa', imageInput({ prompt: 'two' }));
    const t3 = await service.create('sa', imageInput({ prompt: 'three' }));
    expect(t1.status).toBe('running');
    expect(t2.status).toBe('running');
    expect(t3.status).toBe('queued');

    gates[0].resolve(IMAGE_RESULT);
    await waitFor(() => rawTask(t3.id)?.status === 'running');
    expect(rawTask(t1.id)?.status).toBe('completed');
    gates[1].resolve(IMAGE_RESULT);
    gates[2].resolve(IMAGE_RESULT);
    await waitFor(
      () => rawTask(t2.id)?.status === 'completed' && rawTask(t3.id)?.status === 'completed'
    );
  });

  it('keeps one video at a time and shares no slots with image tasks', async () => {
    const image = gatedExecutor();
    const video = gatedExecutor();
    const service = makeService(
      { 'image-generate': image.executor, 'video-render': video.executor },
      { resolveProfileName: () => 'P' }
    );
    const v1 = await service.create('sa', videoInput({ entryPath: 'a.html' }));
    const v2 = await service.create('sa', videoInput({ entryPath: 'b.html' }));
    expect(v1.status).toBe('running');
    expect(v2.status).toBe('queued');
    // image 组并发不受 video 占用影响。
    const i1 = await service.create('sa', imageInput());
    expect(i1.status).toBe('running');

    video.gates[0].resolve(VIDEO_RESULT);
    await waitFor(() => rawTask(v2.id)?.status === 'running');
    expect(rawTask(v1.id)?.status).toBe('completed');
    image.gates[0].resolve(IMAGE_RESULT);
    video.gates[1].resolve(VIDEO_RESULT);
    await waitFor(
      () =>
        rawTask(v2.id)?.status === 'completed' &&
        rawTask(i1.id)?.status === 'completed'
    );
  });

  it('completes tasks with results, lists newest first and bounds the limit', async () => {
    for (let i = 1; i <= 5; i++) {
      insertSeedTask(`seed-${i}`, 'completed', { createdAt: i });
    }
    const { executor, gates } = gatedExecutor();
    const service = makeService({ 'image-generate': executor }, { resolveProfileName: () => 'P' });
    const task = await service.create('sa', imageInput());
    gates[0].resolve(IMAGE_RESULT);
    await waitFor(() => rawTask(task.id)?.status === 'completed');
    expect(rawTask(task.id)?.resultJson).toBe(JSON.stringify(IMAGE_RESULT));

    const listed = await service.list('sa');
    expect(listed[0].id).toBe(task.id);
    expect(listed[0].result).toEqual(IMAGE_RESULT);
    expect(listed[0].error).toBeNull();
    expect(listed.map(entry => entry.id)).toEqual([
      task.id,
      'seed-5',
      'seed-4',
      'seed-3',
      'seed-2',
      'seed-1',
    ]);

    expect((await service.list('sa', 2)).map(entry => entry.id)).toEqual([task.id, 'seed-5']);
    expect(await service.list('sa', 999)).toHaveLength(6); // 上限 200，未触及
    expect(await service.list('sa', 0)).toHaveLength(6); // 非法 → 回退 50 → 全部
    expect(await service.list('sa', 'bogus')).toHaveLength(6);
    expect(await service.list('sb')).toHaveLength(0);
  });

  it('marks failures with run codes, provider codes and INTERNAL fallback', async () => {
    const runErrorExecutor: MediaTaskExecutor = async () => {
      throw new MediaTaskRunError('RUNTIME_MISSING', 'ffmpeg not found');
    };
    const providerErrorExecutor: MediaTaskExecutor = async () => {
      throw new MediaProviderError('provider-timeout', 'Request timed out');
    };
    const internalExecutor: MediaTaskExecutor = async () => {
      throw new Error('boom');
    };
    const service = makeService(
      {
        'image-generate': runErrorExecutor,
        'image-edit': providerErrorExecutor,
        'video-render': internalExecutor,
      },
      { resolveProfileName: () => 'P' }
    );
    const t1 = await service.create('sa', imageInput({ prompt: 'a' }));
    const t2 = await service.create('sa', {
      kind: 'image-edit',
      provider: { profileId: 'p1', model: 'm' },
      prompt: 'b',
      sourcePath: 'src.png',
    });
    const t3 = await service.create('sa', videoInput());
    await waitFor(() => rawTask(t3.id)?.status === 'failed');
    expect(rawTask(t1.id)).toMatchObject({
      errorCode: 'RUNTIME_MISSING',
      errorMessage: 'ffmpeg not found',
    });
    expect(rawTask(t2.id)).toMatchObject({ errorCode: 'PROVIDER_TIMEOUT', errorMessage: 'Request timed out' });
    expect(rawTask(t3.id)).toMatchObject({ errorCode: 'INTERNAL', errorMessage: 'boom' });

    const listed = await service.list('sa');
    expect(listed.find(entry => entry.id === t2.id)?.error).toEqual({
      code: 'PROVIDER_TIMEOUT',
      message: 'Request timed out',
    });
  });

  it('fails with INTERNAL when no executor is configured for the kind', async () => {
    const service = makeService({}, { resolveProfileName: () => 'P' });
    const task = await service.create('sa', imageInput());
    await waitFor(() => rawTask(task.id)?.status === 'failed');
    expect(rawTask(task.id)).toMatchObject({
      errorCode: 'INTERNAL',
      errorMessage: 'No executor is configured for this task type',
    });
  });

  it('persists executor progress via onProgress and keeps it through completion', async () => {
    const executor: MediaTaskExecutor = async (_execution, ctx) => {
      await ctx.onProgress({ phase: 'generating', detail: 'Waiting for the service to respond' });
      return IMAGE_RESULT;
    };
    const service = makeService({ 'image-generate': executor }, { resolveProfileName: () => 'P' });
    const task = await service.create('sa', imageInput());
    await waitFor(
      () => rawTask(task.id)?.progressJson !== null && rawTask(task.id)?.status === 'completed'
    );
    const summary = (await service.list('sa')).find(entry => entry.id === task.id);
    expect(summary?.status).toBe('completed');
    expect(summary?.progress).toEqual({ phase: 'generating', detail: 'Waiting for the service to respond' });
  });

  it('cancels queued tasks directly without invoking the executor', async () => {
    const { executor, gates } = gatedExecutor();
    const service = makeService({ 'image-generate': executor }, { resolveProfileName: () => 'P' });
    const t1 = await service.create('sa', imageInput({ prompt: 'one' }));
    const t2 = await service.create('sa', imageInput({ prompt: 'two' }));
    const t3 = await service.create('sa', imageInput({ prompt: 'three' }));
    expect(t1.status).toBe('running');
    expect(t2.status).toBe('running');
    expect(t3.status).toBe('queued');
    expect(gates).toHaveLength(2);

    const cancelled = await service.cancel('sa', t3.id);
    expect(cancelled.status).toBe('cancelled');
    expect(rawTask(t3.id)?.status).toBe('cancelled');

    // 释放一个槽位后，已取消的排队任务不得被拉起。
    gates[0].resolve(IMAGE_RESULT);
    await waitFor(() => rawTask(t1.id)?.status === 'completed');
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(rawTask(t3.id)?.status).toBe('cancelled');
    expect(gates).toHaveLength(2);
    gates[1].resolve(IMAGE_RESULT);
  });

  it('aborts running tasks and waits for the executor to observe the signal', async () => {
    const { executor, gates } = gatedExecutor();
    const service = makeService({ 'video-render': executor }, { resolveProfileName: () => 'P' });
    const task = await service.create('sa', videoInput());
    expect(task.status).toBe('running');

    const cancelPromise = service.cancel('sa', task.id);
    await waitFor(() => gates[0].ctx.signal.aborted);
    gates[0].reject(new MediaTaskRunError('ABORTED', 'Canceled'));
    const cancelled = await cancelPromise;
    expect(cancelled.status).toBe('cancelled');
    expect(rawTask(task.id)?.status).toBe('cancelled');
    expect(rawTask(task.id)?.errorCode).toBeNull();
  });

  it('keeps the written result when cancel lands after the artifact', async () => {
    const { executor, gates } = gatedExecutor();
    const service = makeService({ 'image-generate': executor }, { resolveProfileName: () => 'P' });
    const task = await service.create('sa', imageInput());
    const cancelPromise = service.cancel('sa', task.id);
    await waitFor(() => gates[0].ctx.signal.aborted);
    gates[0].resolve(IMAGE_RESULT);
    const cancelled = await cancelPromise;
    expect(cancelled.status).toBe('cancelled');
    expect(rawTask(task.id)?.resultJson).toBe(JSON.stringify(IMAGE_RESULT));
  });

  it('rejects cancelling terminal, unknown and cross-workspace tasks', async () => {
    const executor: MediaTaskExecutor = async () => IMAGE_RESULT;
    const service = makeService({ 'image-generate': executor }, { resolveProfileName: () => 'P' });
    const task = await service.create('sa', imageInput());
    await waitFor(() => rawTask(task.id)?.status === 'completed');
    await expect(service.cancel('sa', task.id)).rejects.toMatchObject({
      status: 409,
      code: 'MEDIA_TASK_INVALID_STATE',
    });
    await expect(service.cancel('sa', 'nope')).rejects.toMatchObject({
      status: 404,
      code: 'MEDIA_TASK_NOT_FOUND',
    });
    await expect(service.cancel('sb', task.id)).rejects.toMatchObject({
      status: 404,
      code: 'MEDIA_TASK_NOT_FOUND',
    });
  });

  it('shares one task list and cancel across sessions of the same workspace', async () => {
    const { executor, gates } = gatedExecutor();
    const service = makeService({ 'image-generate': executor }, { resolveProfileName: () => 'P' });
    const task = await service.create('sa', imageInput());
    expect((await service.list('sa2')).map(entry => entry.id)).toEqual([task.id]);

    const cancelPromise = service.cancel('sa2', task.id);
    await waitFor(() => gates[0].ctx.signal.aborted);
    gates[0].reject(new MediaTaskRunError('ABORTED', 'Canceled'));
    const cancelled = await cancelPromise;
    expect(cancelled.status).toBe('cancelled');
  });

  it('marks leftover queued/running rows as INTERRUPTED on construction', async () => {
    insertSeedTask('legacy-1', 'running');
    insertSeedTask('legacy-2', 'queued');
    insertSeedTask('done', 'completed');

    makeService({});
    const rows = db
      .prepare(
        `SELECT id, status, error_code AS errorCode, error_message AS errorMessage
         FROM design_media_tasks WHERE id LIKE 'legacy-%' ORDER BY id`
      )
      .all() as Array<{
      id: string;
      status: string;
      errorCode: string | null;
      errorMessage: string | null;
    }>;
    expect(rows).toEqual([
      {
        id: 'legacy-1',
        status: 'failed',
        errorCode: 'INTERRUPTED',
        errorMessage: 'Task interrupted by a service restart',
      },
      {
        id: 'legacy-2',
        status: 'failed',
        errorCode: 'INTERRUPTED',
        errorMessage: 'Task interrupted by a service restart',
      },
    ]);
    expect(db.prepare('SELECT status FROM design_media_tasks WHERE id = ?').get('done')).toMatchObject(
      { status: 'completed' }
    );
  });

  it('keeps only the newest 100 tasks per workspace', async () => {
    for (let i = 1; i <= 100; i++) {
      insertSeedTask(`old-${i}`, 'completed', { createdAt: i });
    }
    const { executor, gates } = gatedExecutor();
    const service = makeService({ 'image-generate': executor }, { resolveProfileName: () => 'P' });
    const task = await service.create('sa', imageInput());
    gates[0].resolve(IMAGE_RESULT);
    await waitFor(() => rawTask(task.id)?.status === 'completed');

    const rows = db
      .prepare('SELECT id FROM design_media_tasks WHERE workspace_root = ?')
      .all(storedRootA) as Array<{ id: string }>;
    expect(rows).toHaveLength(100);
    expect(rows.some(row => row.id === 'old-1')).toBe(false);
    expect(rows.some(row => row.id === 'old-100')).toBe(true);
    expect(rows.some(row => row.id === task.id)).toBe(true);
  });

  it('returns the result download target for completed tasks with containment', async () => {
    await mkdir(path.join(storedRootA, 'design', 'assets'), { recursive: true });
    await writeFile(path.join(storedRootA, 'design', 'assets', 'gen.png'), PNG_BYTES);
    insertSeedTask('t-done', 'completed', {
      resultJson: JSON.stringify({
        path: 'design/assets/gen.png',
        bytes: PNG_BYTES.length,
        mime: 'image/png',
        usage: null,
      }),
    });
    insertSeedTask('t-running', 'running');

    const service = makeService({});
    const target = await service.resultTarget('sa', 't-done');
    expect(target).toEqual({
      absolutePath: path.join(storedRootA, 'design', 'assets', 'gen.png'),
      fileName: 'gen.png',
      mime: 'image/png',
      bytes: PNG_BYTES.length,
    });

    await expect(service.resultTarget('sa', 't-running')).rejects.toMatchObject({
      status: 409,
      code: 'MEDIA_TASK_INVALID_STATE',
    });
    await expect(service.resultTarget('sa', 'nope')).rejects.toMatchObject({
      status: 404,
      code: 'MEDIA_TASK_NOT_FOUND',
    });
  });

  it('rejects result targets whose stored path escapes the workspace via symlink', async () => {
    await writeFile(path.join(temp, 'outside.png'), Buffer.from([1]));
    await symlink(path.join(temp, 'outside.png'), path.join(storedRootA, 'escape.png'));
    insertSeedTask('t-escape', 'completed', {
      resultJson: JSON.stringify({ path: 'escape.png', bytes: 1, mime: 'image/png', usage: null }),
    });
    const service = makeService({});
    await expect(service.resultTarget('sa', 't-escape')).rejects.toMatchObject({
      status: 403,
      code: 'PATH_FORBIDDEN',
    });
  });
});

describe('createImageTaskExecutor', () => {
  let temp: string;
  let rootA: string;
  let db: Database.Database;
  let designService: DesignService;

  beforeEach(async () => {
    temp = await mkdtemp(path.join(os.tmpdir(), 'design-media-exec-'));
    rootA = path.join(temp, 'a');
    await mkdir(rootA);
    db = new Database(':memory:');
    db.exec(`CREATE TABLE projects (id TEXT PRIMARY KEY, root_path TEXT);
      CREATE TABLE sessions (id TEXT PRIMARY KEY, project_id TEXT, working_directory TEXT);
      INSERT INTO projects VALUES ('pa', '${rootA}');
      INSERT INTO sessions VALUES ('sa', 'pa', NULL);`);
    db.exec(migration051.sql);
    designService = new DesignService(db);
  });

  afterEach(async () => {
    db.close();
    await rm(temp, { recursive: true, force: true });
  });

  /** 经真实 designService.readAsset/importAsset 的回调绑定（L33 组装形态）。 */
  function boundCallbacks() {
    return {
      readSourceImage: async (sessionId: string, sourcePath: string) => {
        const asset = await designService.readAsset(sessionId, sourcePath);
        return { mime: asset.mimeType, bytes: Buffer.from(asset.data, 'base64') };
      },
      importGeneratedImage: async (
        sessionId: string,
        fileName: string,
        bytes: Buffer,
        targetDir?: string
      ) => designService.importAsset(sessionId, fileName, bytes.toString('base64'), targetDir),
    };
  }

  function generateExecution(prompt: string): MediaTaskExecution {
    return {
      id: 'exec-1',
      kind: 'image-generate',
      params: { type: 'image-generate', prompt, targetDir: 'design/assets' },
      provider: providerRef(),
      sessionId: 'sa',
    };
  }

  function editExecution(prompt: string, size?: string): MediaTaskExecution {
    return {
      id: 'exec-1',
      kind: 'image-edit',
      params: {
        type: 'image-edit',
        prompt,
        sourcePath: 'assets/src.png',
        ...(size !== undefined ? { size } : {}),
        targetDir: 'design/assets',
      },
      provider: providerRef(),
      sessionId: 'sa',
    };
  }

  it('generates via the fake provider and imports the artifact without overwriting', async () => {
    const fake = fakeProvider({ bytes: PNG_BYTES, mime: 'image/png', usage: { totalCostUsd: 0.02 } });
    const seenRefs: DesignMediaProviderRef[] = [];
    const ctx = testCtx();
    const executor = createImageTaskExecutor({
      designService,
      makeProvider: async ref => {
        seenRefs.push(ref);
        return fake.provider;
      },
      ...boundCallbacks(),
    });

    const result = await executor(generateExecution('Hello World!'), ctx);
    expect(seenRefs).toEqual([providerRef()]);
    expect(fake.generate).toHaveBeenCalledWith({
      prompt: 'Hello World!',
      size: undefined,
      signal: ctx.signal,
    });
    expect(result).toMatchObject({
      bytes: PNG_BYTES.length,
      mime: 'image/png',
      usage: { totalCostUsd: 0.02 },
    });
    expect(result.path).toMatch(/^design\/assets\/gen-hello-world-\d{8}-\d{6}\.png$/);
    expect(await readFile(path.join(rootA, result.path))).toEqual(PNG_BYTES);

    // 同 prompt 再次生成：新文件 -2 后缀，原文件内容不变（永不覆盖）。
    const second = await executor(generateExecution('Hello World!'), ctx);
    expect(second.path).toMatch(/^design\/assets\/gen-hello-world-\d{8}-\d{6}-2\.png$/);
    expect(await readFile(path.join(rootA, result.path))).toEqual(PNG_BYTES);
  });

  it('falls back to the image slug for non-ascii prompts and honors targetDir', async () => {
    const fake = fakeProvider({ bytes: PNG_BYTES, mime: 'image/webp', usage: null });
    const executor = createImageTaskExecutor({
      designService,
      makeProvider: async () => fake.provider,
      ...boundCallbacks(),
    });
    const execution = generateExecution('一只猫 动图');
    execution.params = { ...execution.params, targetDir: 'design/generated' };
    const result = await executor(execution, testCtx());
    expect(result.path).toMatch(/^design\/generated\/gen-image-\d{8}-\d{6}\.webp$/);
    expect(await readFile(path.join(rootA, result.path))).toEqual(PNG_BYTES);
  });

  it('reads the source image for edits and forwards it to provider.edit', async () => {
    await mkdir(path.join(rootA, 'assets'), { recursive: true });
    await writeFile(path.join(rootA, 'assets', 'src.png'), SOURCE_PNG_BYTES);
    const edited = Buffer.from([1, 2, 3]);
    const fake = fakeProvider({ bytes: edited, mime: 'image/jpeg', usage: null });
    const executor = createImageTaskExecutor({
      designService,
      makeProvider: async () => fake.provider,
      ...boundCallbacks(),
    });
    const ctx = testCtx();
    const result = await executor(editExecution('把背景换成夜晚', '512x512'), ctx);
    expect(fake.edit).toHaveBeenCalledWith({
      prompt: '把背景换成夜晚',
      size: '512x512',
      source: { path: 'assets/src.png', mime: 'image/png', bytes: SOURCE_PNG_BYTES },
      signal: ctx.signal,
    });
    expect(result.mime).toBe('image/jpeg');
    expect(result.path).toMatch(/^design\/assets\/gen-image-\d{8}-\d{6}\.jpg$/);
    expect(await readFile(path.join(rootA, result.path))).toEqual(edited);
  });

  it('fails with ENTRY_UNREADABLE when the source image is unreadable or oversized', async () => {
    const fake = fakeProvider({ bytes: PNG_BYTES, mime: 'image/png', usage: null });
    const ctx = testCtx();
    const brokenExecutor = createImageTaskExecutor({
      designService,
      makeProvider: async () => fake.provider,
      readSourceImage: async () => {
        throw new Error('missing file');
      },
      importGeneratedImage: async () => ({ path: 'design/assets/x.png' }),
    });
    await expect(brokenExecutor(editExecution('edit'), ctx)).rejects.toMatchObject({
      name: 'MediaTaskRunError',
      code: 'ENTRY_UNREADABLE',
      message: 'Source image is not readable: missing file',
    });

    const oversizedExecutor = createImageTaskExecutor({
      designService,
      makeProvider: async () => fake.provider,
      readSourceImage: async () => ({
        mime: 'image/png',
        bytes: Buffer.alloc(MEDIA_IMAGE_SOURCE_MAX_BYTES + 1),
      }),
      importGeneratedImage: async () => ({ path: 'design/assets/x.png' }),
    });
    await expect(oversizedExecutor(editExecution('edit'), ctx)).rejects.toMatchObject({
      code: 'ENTRY_UNREADABLE',
    });
    expect(fake.generate).not.toHaveBeenCalled();
    expect(fake.edit).not.toHaveBeenCalled();
  });

  it('maps artifact write failures to ASSET_WRITE_FAILED and missing provider refs to INTERNAL', async () => {
    const ctx = testCtx();
    const writeFails = createImageTaskExecutor({
      designService,
      makeProvider: async () =>
        fakeProvider({ bytes: PNG_BYTES, mime: 'image/png', usage: null }).provider,
      readSourceImage: async () => ({ mime: 'image/png', bytes: SOURCE_PNG_BYTES }),
      importGeneratedImage: async () => {
        throw new DesignError(400, 'ASSET_INVALID', 'Unsupported file extension');
      },
    });
    await expect(writeFails(generateExecution('x'), ctx)).rejects.toMatchObject({
      code: 'ASSET_WRITE_FAILED',
      message: 'Unsupported file extension',
    });

    const noProvider = createImageTaskExecutor({
      designService,
      makeProvider: async () =>
        fakeProvider({ bytes: PNG_BYTES, mime: 'image/png', usage: null }).provider,
      readSourceImage: async () => ({ mime: 'image/png', bytes: SOURCE_PNG_BYTES }),
      importGeneratedImage: async () => ({ path: 'design/assets/x.png' }),
    });
    await expect(
      noProvider({ ...generateExecution('x'), provider: null }, ctx)
    ).rejects.toMatchObject({ code: 'INTERNAL' });
  });

  it('runs the image executor end-to-end through MediaTaskService', async () => {
    const fake = fakeProvider({ bytes: PNG_BYTES, mime: 'image/png', usage: null });
    const executor = createImageTaskExecutor({
      designService,
      makeProvider: async () => fake.provider,
      ...boundCallbacks(),
    });
    const service = new MediaTaskService(
      db,
      designService,
      { 'image-generate': executor, 'image-edit': executor },
      { resolveProfileName: () => 'BigModel' }
    );
    const task = await service.create('sa', imageInput({ prompt: 'sunset over mountains' }));
    const statusOf = (): string | undefined =>
      (
        db.prepare('SELECT status FROM design_media_tasks WHERE id = ?').get(task.id) as
          | { status: string }
          | undefined
      )?.status;
    await waitFor(() => statusOf() === 'completed');

    const summary = (await service.list('sa')).find(entry => entry.id === task.id);
    expect(summary?.status).toBe('completed');
    expect(summary?.result?.path).toMatch(
      /^design\/assets\/gen-sunset-over-mountains-\d{8}-\d{6}\.png$/
    );
    expect(await readFile(path.join(rootA, summary!.result!.path))).toEqual(PNG_BYTES);
    expect(summary?.result?.usage).toBeNull();
  });
});

describe('createGeneratedAssetWriter', () => {
  let temp: string;
  let rootA: string;
  let db: Database.Database;
  let designService: DesignService;

  beforeEach(async () => {
    temp = await mkdtemp(path.join(os.tmpdir(), 'design-media-writer-'));
    rootA = path.join(temp, 'a');
    await mkdir(rootA);
    db = new Database(':memory:');
    db.exec(`CREATE TABLE projects (id TEXT PRIMARY KEY, root_path TEXT);
      CREATE TABLE sessions (id TEXT PRIMARY KEY, project_id TEXT, working_directory TEXT);
      INSERT INTO projects VALUES ('pa', '${rootA}');
      INSERT INTO sessions VALUES ('sa', 'pa', NULL);`);
    db.exec(migration051.sql);
    designService = new DesignService(db);
  });

  afterEach(async () => {
    db.close();
    await rm(temp, { recursive: true, force: true });
  });

  it('writes assets with -2/-3 dedupe and never overwrites existing files', async () => {
    const writer = createGeneratedAssetWriter(designService, 'sa');
    const first = await writer('render-demo.mp4', Buffer.from('v1'), 'video/mp4');
    expect(first).toEqual({ path: 'design/assets/render-demo.mp4', bytes: 2 });
    expect(await readFile(path.join(rootA, 'design/assets/render-demo.mp4'), 'utf8')).toBe('v1');

    const second = await writer('render-demo.mp4', Buffer.from('longer-second'), 'video/mp4');
    expect(second).toEqual({ path: 'design/assets/render-demo-2.mp4', bytes: 13 });
    const third = await writer('render-demo.mp4', Buffer.from('v3'), 'video/mp4');
    expect(third.path).toBe('design/assets/render-demo-3.mp4');
    // 原文件从未被覆盖；嵌套目录按需创建。
    expect(await readFile(path.join(rootA, 'design/assets/render-demo.mp4'), 'utf8')).toBe('v1');
    expect(await readFile(path.join(rootA, 'design/assets/render-demo-2.mp4'), 'utf8')).toBe(
      'longer-second'
    );
  });

  it('rejects invalid or escaping file names with ASSET_INVALID', async () => {
    const writer = createGeneratedAssetWriter(designService, 'sa');
    const names = [
      'render.mp3',
      'render',
      '.mov',
      'a/b.mp4',
      '..\\x.mp4',
      '../x.mp4',
      'x\0.mp4',
      `${'n'.repeat(201)}.mp4`,
    ];
    for (const name of names) {
      await expect(writer(name, Buffer.from('x'), 'video/mp4')).rejects.toMatchObject({
        status: 400,
        code: 'ASSET_INVALID',
      });
    }
    // 拒绝路径上没有落任何文件。
    expect(await designService.listAssets('sa', 'all')).toEqual({ files: [] });
  });

  it('exhausts rename candidates with ASSET_INVALID after 100 collisions', async () => {
    const dir = path.join(rootA, 'design', 'assets');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'demo.mp4'), 'x');
    for (let i = 2; i <= 101; i++) await writeFile(path.join(dir, `demo-${i}.mp4`), 'x');
    const writer = createGeneratedAssetWriter(designService, 'sa');
    await expect(writer('demo.mp4', Buffer.from('new'), 'video/mp4')).rejects.toMatchObject({
      status: 400,
      code: 'ASSET_INVALID',
    });
    expect(await readFile(path.join(dir, 'demo.mp4'), 'utf8')).toBe('x');
  });
});
