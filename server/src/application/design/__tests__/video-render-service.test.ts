// L32 视频渲染执行器测试：deps 全注入假件，零真实 Chrome/ffmpeg；
// 仅「真子进程击杀」用例用真实 spawn（node -e 长眠进程）+ 真 killProcessTree。
import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MEDIA_GENERATED_VIDEO_MAX_BYTES,
  MediaTaskRunError,
  type DesignMediaProgress,
  type DesignMediaTaskParamsVideoRender,
  type MediaExecutorContext,
  type MediaTaskExecution,
} from '../media-types.js';
import {
  assertOutputWithinLimit,
  createVideoRenderExecutor,
  defaultVideoRenderDeps,
  resolveFfmpegPath,
  type EncoderWaitResult,
  type RenderBrowser,
  type RenderPage,
  type VideoRenderDeps,
} from '../video-render-service.js';
import { waitForProcessesToExit } from '../../../utils/process-tree.js';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const FAKE_MP4 = Buffer.from('FAKEMP4!');
const FFMPEG_OK: EncoderWaitResult = { code: 0, stdout: FAKE_MP4, stderrTail: '' };

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitFor(condition: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('waitFor: condition not met in time');
    await delay(10);
  }
}

class FakePage implements RenderPage {
  startCount = 0;
  stopCount = 0;
  closeCount = 0;
  framesEmitted = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly jpeg: Buffer;

  constructor(
    private readonly options: {
      mode?: 'burst' | 'interval';
      burstCount?: number;
      intervalMs?: number;
      jpeg?: Buffer;
    } = {}
  ) {
    this.jpeg = options.jpeg ?? JPEG;
  }

  async startScreencast(onFrame: (jpeg: Buffer) => void): Promise<void> {
    this.startCount += 1;
    if ((this.options.mode ?? 'burst') === 'burst') {
      for (let i = 0; i < (this.options.burstCount ?? 0); i += 1) {
        this.framesEmitted += 1;
        onFrame(this.jpeg);
      }
      return;
    }
    this.timer = setInterval(() => {
      this.framesEmitted += 1;
      onFrame(this.jpeg);
    }, this.options.intervalMs ?? 10);
  }

  async stopScreencast(): Promise<void> {
    this.stopCount += 1;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async close(): Promise<void> {
    this.closeCount += 1;
  }
}

class FakeBrowser implements RenderBrowser {
  openCalls: { url: string; viewport: { width: number; height: number } }[] = [];
  closeCount = 0;

  constructor(private readonly page: FakePage) {}

  async openPage(url: string, viewport: { width: number; height: number }): Promise<RenderPage> {
    this.openCalls.push({ url, viewport });
    return this.page;
  }

  async close(): Promise<void> {
    this.closeCount += 1;
  }
}

/** wait() 在 endStdin（或 killTree 模拟进程死亡）后才 settle，模拟真实 ffmpeg 的 EOF 退出。 */
class FakeEncoder {
  readonly pid = 4242;
  readonly chunks: Buffer[] = [];
  ended = false;
  private settleWait: ((result: EncoderWaitResult) => void) | null = null;
  private readonly waitPromise: Promise<EncoderWaitResult>;

  constructor(
    private readonly result: EncoderWaitResult,
    private readonly drainDelayMs: number
  ) {
    this.waitPromise = new Promise(resolve => {
      this.settleWait = resolve;
    });
  }

  async writeStdin(chunk: Buffer): Promise<void> {
    if (this.drainDelayMs > 0) await delay(this.drainDelayMs);
    this.chunks.push(chunk);
  }

  endStdin(): void {
    this.ended = true;
    this.settleWait!(this.result);
  }

  forceSettle(result: EncoderWaitResult): void {
    this.settleWait!(result);
  }

  wait(): Promise<EncoderWaitResult> {
    return this.waitPromise;
  }
}

interface FakeWorld {
  deps: VideoRenderDeps;
  page: FakePage;
  browser: FakeBrowser;
  encoder: FakeEncoder;
  spawnArgSets: string[][];
  killedPids: number[];
  saved: Buffer[];
  launchCount(): number;
}

function makeWorld(
  options?: {
    page?: { mode?: 'burst' | 'interval'; burstCount?: number; intervalMs?: number; jpeg?: Buffer };
    encoder?: { result?: EncoderWaitResult; drainDelayMs?: number };
  } & Partial<Pick<VideoRenderDeps, 'launchBrowser' | 'resolveFfmpeg'>>
): FakeWorld {
  const page = new FakePage(options?.page);
  const browser = new FakeBrowser(page);
  const encoder = new FakeEncoder(
    options?.encoder?.result ?? FFMPEG_OK,
    options?.encoder?.drainDelayMs ?? 0
  );
  const spawnArgSets: string[][] = [];
  const killedPids: number[] = [];
  const saved: Buffer[] = [];
  let launched = 0;
  const resolveFfmpeg = options?.resolveFfmpeg ?? (async () => 'ffmpeg-fake');
  const launchBrowser =
    options?.launchBrowser ??
    (async () => {
      launched += 1;
      return browser;
    });
  const deps: VideoRenderDeps = {
    launchBrowser,
    resolveFfmpeg,
    spawnFfmpeg: args => {
      spawnArgSets.push(args);
      return encoder;
    },
    killTree: async pid => {
      killedPids.push(pid);
      // 模拟 killProcessTree 后进程退出 → wait() settle。
      encoder.forceSettle({ code: null, stdout: Buffer.alloc(0), stderrTail: 'killed' });
    },
    saveOutput: async (_sessionId, bytes) => {
      saved.push(bytes);
      return { path: 'design/assets/render-index-1.mp4', bytes: bytes.length };
    },
  };
  return {
    deps,
    page,
    browser,
    encoder,
    spawnArgSets,
    killedPids,
    saved,
    launchCount: () => launched,
  };
}

function makeExecution(
  overrides?: Partial<DesignMediaTaskParamsVideoRender>
): MediaTaskExecution {
  return {
    id: 'task-1',
    kind: 'video-render',
    params: {
      type: 'video-render',
      entryPath: 'index.html',
      width: 1280,
      height: 720,
      fps: 30,
      durationMs: 600,
      ...overrides,
    },
    provider: null,
  };
}

interface CtxHarness {
  ctx: MediaExecutorContext;
  controller: AbortController;
  progress: DesignMediaProgress[];
}

function makeCtx(root: string): CtxHarness {
  const progress: DesignMediaProgress[] = [];
  const controller = new AbortController();
  const ctx: MediaExecutorContext = {
    signal: controller.signal,
    onProgress: async update => {
      progress.push(update);
    },
    workspaceRoot: root,
    resolveWorkspacePath: async relativePath => path.join(root, relativePath),
  };
  return { ctx, controller, progress };
}

function errorCode(err: unknown): string {
  expect(err).toBeInstanceOf(MediaTaskRunError);
  return (err as MediaTaskRunError).code;
}

describe('createVideoRenderExecutor', () => {
  let temp: string;
  let root: string;

  beforeEach(async () => {
    temp = await mkdtemp(path.join(os.tmpdir(), 'design-video-render-'));
    root = path.join(temp, 'workspace');
    await mkdir(root, { recursive: true });
    await writeFile(path.join(root, 'index.html'), '<!doctype html><html></html>');
  });

  afterEach(async () => {
    await rm(temp, { recursive: true, force: true });
  });

  it('rejects odd or out-of-range dimensions/fps/duration before spawning anything', async () => {
    const cases: Partial<DesignMediaTaskParamsVideoRender>[] = [
      { width: 1281 },
      { height: 719 },
      { width: 100 },
      { height: 3000 },
      { fps: 7 },
      { fps: 61 },
      { durationMs: 100 },
      { durationMs: 120_000 },
    ];
    for (const override of cases) {
      const world = makeWorld();
      const { ctx } = makeCtx(root);
      await expect(createVideoRenderExecutor(world.deps)(makeExecution(override), ctx)).rejects.toThrow(
        /Invalid video parameters/
      );
      expect(world.spawnArgSets).toEqual([]);
      expect(world.launchCount()).toBe(0);
    }
  });

  it('fails with RUNTIME_MISSING when Chrome is unavailable and never spawns ffmpeg', async () => {
    const world = makeWorld({
      launchBrowser: async () => {
        throw new MediaTaskRunError(
          'RUNTIME_MISSING',
          '未找到可用的 Chrome/Chromium。请在设置中安装浏览器引擎后重试。'
        );
      },
    });
    const { ctx } = makeCtx(root);
    const err = await createVideoRenderExecutor(world.deps)(makeExecution(), ctx).catch(
      (e: unknown) => e
    );
    expect(errorCode(err)).toBe('RUNTIME_MISSING');
    expect((err as MediaTaskRunError).message).toContain('Chrome');
    // §4.4 顺序：encoder 先于浏览器 spawn；浏览器失败后 cleanup 击杀 encoder。
    expect(world.spawnArgSets).toHaveLength(1);
    expect(world.killedPids).toEqual([4242]);
  });

  it('fails with RUNTIME_MISSING when ffmpeg is missing, before launching the browser', async () => {
    const world = makeWorld({ resolveFfmpeg: async () => null });
    const { ctx } = makeCtx(root);
    const err = await createVideoRenderExecutor(world.deps)(makeExecution(), ctx).catch(
      (e: unknown) => e
    );
    expect(errorCode(err)).toBe('RUNTIME_MISSING');
    expect((err as MediaTaskRunError).message).toContain('brew install ffmpeg');
    expect((err as MediaTaskRunError).message).toContain('FFMPEG_PATH');
    expect(world.launchCount()).toBe(0);
    expect(world.spawnArgSets).toEqual([]);
  });

  it('fails with ENTRY_UNREADABLE when the entry is missing or not a regular file', async () => {
    await mkdir(path.join(root, 'sub'));
    for (const entryPath of ['missing.html', 'sub']) {
      const world = makeWorld();
      const { ctx } = makeCtx(root);
      const err = await createVideoRenderExecutor(world.deps)(
        makeExecution({ entryPath }),
        ctx
      ).catch((e: unknown) => e);
      expect(errorCode(err)).toBe('ENTRY_UNREADABLE');
      expect(world.spawnArgSets).toEqual([]);
      expect(world.launchCount()).toBe(0);
    }
  });

  it('runs the happy path: frame bytes reach stdin, args match §4.3, output is saved', async () => {
    const world = makeWorld({ page: { mode: 'burst', burstCount: 25 } });
    const { ctx, progress } = makeCtx(root);
    const result = await createVideoRenderExecutor(world.deps)(makeExecution(), ctx);

    // §4.3 完整 ffmpeg 命令行（args[0] 为可执行文件）。
    expect(world.spawnArgSets).toHaveLength(1);
    expect(world.spawnArgSets[0]).toEqual([
      'ffmpeg-fake',
      '-y',
      '-f',
      'image2pipe',
      '-framerate',
      '30',
      '-i',
      'pipe:0',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-pix_fmt',
      'yuv420p',
      '-an',
      '-movflags',
      'frag_keyframe+empty_moov',
      '-f',
      'mp4',
      'pipe:1',
    ]);

    // 时隙节流 + 尾帧补齐（真实冒烟修正）：25 帧瞬时突发只占首时隙（1 帧实采），
    // 其余以尾帧补齐——写入总数恒等于目标帧数（600ms × 30fps = 18），时长才等于请求值。
    expect(world.encoder.chunks).toHaveLength(18);
    expect(Buffer.concat(world.encoder.chunks)).toEqual(Buffer.concat(Array(18).fill(JPEG)));
    expect(world.encoder.ended).toBe(true);

    // 打开的页面：file:// 入口 + 视口。
    expect(world.browser.openCalls).toHaveLength(1);
    expect(world.browser.openCalls[0]!.viewport).toEqual({ width: 1280, height: 720 });
    const { url } = world.browser.openCalls[0]!;
    expect(url.startsWith('file://')).toBe(true);
    expect(fileURLToPath(url)).toBe(path.join(root, 'index.html'));

    // 采集与浏览器收尾。
    expect(world.page.stopCount).toBe(1);
    expect(world.page.closeCount).toBe(1);
    expect(world.browser.closeCount).toBe(1);

    // 产物经 saveOutput 落库。
    expect(world.saved).toHaveLength(1);
    expect(world.saved[0]).toEqual(FAKE_MP4);
    expect(result).toEqual({
      path: 'design/assets/render-index-1.mp4',
      bytes: FAKE_MP4.length,
      mime: 'video/mp4',
      usage: null,
    });

    // 阶段序列与帧进度：burst 只实写首帧（进度 0），其余在补齐循环内完成（无中间上报）。
    expect(progress.map(p => p.phase)).toEqual(['launching', 'rendering', 'encoding', 'saving']);
    expect(progress.filter(p => p.phase === 'rendering').map(p => p.frames)).toEqual([0]);
  });

  it('stops screencast collection at the duration deadline', async () => {
    const world = makeWorld({ page: { mode: 'interval', intervalMs: 10 } });
    const { ctx } = makeCtx(root);
    await createVideoRenderExecutor(world.deps)(makeExecution({ durationMs: 500 }), ctx);

    expect(world.page.stopCount).toBe(1);
    const framesAtStop = world.page.framesEmitted;
    expect(framesAtStop).toBeGreaterThan(0);
    await delay(60);
    expect(world.page.framesEmitted).toBe(framesAtStop);
  });

  it('applies backpressure without deadlocking (slow consumer)', async () => {
    const world = makeWorld({
      page: { mode: 'interval', intervalMs: 10 },
      encoder: { drainDelayMs: 50 },
    });
    const { ctx, progress } = makeCtx(root);
    await createVideoRenderExecutor(world.deps)(makeExecution({ durationMs: 500 }), ctx);

    // 消费（50ms/写）慢于时隙速率（33ms/槽）→ 写入链持续积压；冲刷后全部
    // 抵达 stdin：无死锁、已开槽的帧不丢（时隙节流只丢过密帧），总数恒等于
    // 目标帧数（500ms × 30fps = 15）。interval 模式下 onFrame 实写跨过第 10
    // 帧会触发帧进度上报。
    expect(world.encoder.chunks).toHaveLength(15);
    expect(Buffer.concat(world.encoder.chunks).length).toBe(15 * JPEG.length);
    expect(progress.filter(p => p.phase === 'rendering').map(p => p.frames)).toContain(10);
  });

  it('fails with RENDER_FAILED when the page never produces a frame', async () => {
    const world = makeWorld({ page: { mode: 'burst', burstCount: 0 } });
    const { ctx } = makeCtx(root);
    const err = await createVideoRenderExecutor(world.deps)(makeExecution(), ctx).catch(
      (e: unknown) => e
    );
    expect(errorCode(err)).toBe('RENDER_FAILED');
    expect((err as MediaTaskRunError).message).toContain('no video frames');
    // 零帧也要收尾：killTree 被调（cleanup 路径），产物不落库。
    expect(world.killedPids).toEqual([4242]);
    expect(world.saved).toHaveLength(0);
  });

  it('fails with ENCODE_FAILED when ffmpeg exits non-zero, including a stderr digest', async () => {
    const world = makeWorld({
      page: { mode: 'burst', burstCount: 3 },
      encoder: {
        result: {
          code: 1,
          stdout: Buffer.from([1]),
          stderrTail: 'Unknown encoder libx264\n  Error initializing output stream\n',
        },
      },
    });
    const { ctx } = makeCtx(root);
    const err = await createVideoRenderExecutor(world.deps)(makeExecution(), ctx).catch(
      (e: unknown) => e
    );
    expect(errorCode(err)).toBe('ENCODE_FAILED');
    expect((err as MediaTaskRunError).message).toContain('exit code 1');
    expect((err as MediaTaskRunError).message).toContain('Unknown encoder libx264');
    expect(world.saved).toHaveLength(0);
  });

  it('fails with ENCODE_FAILED when ffmpeg succeeds but produces empty output', async () => {
    const world = makeWorld({
      page: { mode: 'burst', burstCount: 3 },
      encoder: { result: { code: 0, stdout: Buffer.alloc(0), stderrTail: '' } },
    });
    const { ctx } = makeCtx(root);
    const err = await createVideoRenderExecutor(world.deps)(makeExecution(), ctx).catch(
      (e: unknown) => e
    );
    expect(errorCode(err)).toBe('ENCODE_FAILED');
    expect((err as MediaTaskRunError).message).toContain('no output data');
    expect(world.saved).toHaveLength(0);
  });

  it('fails with ENCODE_FAILED when stdout exceeds the 256 MiB limit', async () => {
    const world = makeWorld({
      page: { mode: 'burst', burstCount: 3 },
      encoder: {
        result: { code: 0, stdout: Buffer.alloc(MEDIA_GENERATED_VIDEO_MAX_BYTES + 1), stderrTail: '' },
      },
    });
    const { ctx } = makeCtx(root);
    const err = await createVideoRenderExecutor(world.deps)(makeExecution(), ctx).catch(
      (e: unknown) => e
    );
    expect(errorCode(err)).toBe('ENCODE_FAILED');
    expect((err as MediaTaskRunError).message).toContain('Output exceeded the size limit');
    expect(world.saved).toHaveLength(0);
  });

  it('assertOutputWithinLimit is the reusable limit gate', () => {
    expect(() => assertOutputWithinLimit(Buffer.alloc(4), 2)).toThrow(/Output exceeded the size limit/);
    expect(() => assertOutputWithinLimit(Buffer.alloc(2), 2)).not.toThrow();
    expect(() =>
      assertOutputWithinLimit(Buffer.alloc(MEDIA_GENERATED_VIDEO_MAX_BYTES + 1))
    ).toThrow(/Output exceeded the size limit/);
    expect(() => assertOutputWithinLimit(FAKE_MP4)).not.toThrow();
  });

  it('aborts mid-render: stops screencast, closes browser, kills encoder, throws ABORTED', async () => {
    const world = makeWorld({ page: { mode: 'interval', intervalMs: 20 } });
    const { ctx, controller } = makeCtx(root);
    const running = createVideoRenderExecutor(world.deps)(
      makeExecution({ durationMs: 30_000 }),
      ctx
    );
    await waitFor(() => world.page.startCount > 0);
    controller.abort();
    const err = await running.catch((e: unknown) => e);
    expect(errorCode(err)).toBe('ABORTED');
    expect((err as MediaTaskRunError).message).toBe('Canceled');
    expect(world.killedPids).toEqual([4242]);
    expect(world.page.stopCount).toBeGreaterThanOrEqual(1);
    expect(world.browser.closeCount).toBeGreaterThanOrEqual(1);
    expect(world.saved).toHaveLength(0);
  });

  it('kills a real spawned subprocess via killProcessTree on cancel', async () => {
    let realEncoderPid: number | null = null;
    const fakePage = new FakePage({ mode: 'interval', intervalMs: 20 });
    const deps: VideoRenderDeps = {
      ...defaultVideoRenderDeps(),
      resolveFfmpeg: async () => '/bin/echo', // 占位：spawnFfmpeg 被覆盖，不会真正执行 ffmpeg
      launchBrowser: async () => new FakeBrowser(fakePage),
      spawnFfmpeg: (args, opts) => {
        // 真实 detached 子进程：node -e 长眠 30s，等待被击杀。
        const encoder = defaultVideoRenderDeps().spawnFfmpeg(
          [process.execPath, '-e', 'setTimeout(() => {}, 30000)'],
          opts
        );
        realEncoderPid = encoder.pid;
        return encoder;
      },
      saveOutput: async (_sessionId, bytes) => ({
        path: 'design/assets/render-index-1.mp4',
        bytes: bytes.length,
      }),
    };
    const { ctx, controller } = makeCtx(root);
    const running = createVideoRenderExecutor(deps)(
      makeExecution({ durationMs: 30_000 }),
      ctx
    );
    await waitFor(() => fakePage.startCount > 0 && realEncoderPid !== null);
    expect(realEncoderPid).toBeGreaterThan(0);
    controller.abort();
    const err = await running.catch((e: unknown) => e);
    expect(errorCode(err)).toBe('ABORTED');
    // 真 killProcessTree 击杀后进程退出（轮询直至消失）。
    const survivors = await waitForProcessesToExit([realEncoderPid!], 5000);
    expect(survivors).toEqual([]);
  });
});

describe('resolveFfmpegPath', () => {
  let temp: string;

  beforeEach(async () => {
    temp = await mkdtemp(path.join(os.tmpdir(), 'design-ffmpeg-probe-'));
  });

  afterEach(async () => {
    await rm(temp, { recursive: true, force: true });
  });

  it('returns FFMPEG_PATH when it points at an executable', async () => {
    const script = path.join(temp, 'ffmpeg-fake');
    await writeFile(script, '#!/bin/sh\nexit 0\n');
    await chmod(script, 0o755);
    await expect(resolveFfmpegPath({ FFMPEG_PATH: script })).resolves.toBe(script);
  });

  it('skips FFMPEG_PATH when it is missing or not executable', async () => {
    const notExecutable = path.join(temp, 'ffmpeg-noexec');
    await writeFile(notExecutable, '#!/bin/sh\nexit 0\n');
    await chmod(notExecutable, 0o644);
    if (process.getuid?.() !== 0) {
      const probed = await resolveFfmpegPath({ FFMPEG_PATH: notExecutable });
      expect(probed).not.toBe(notExecutable);
    }
    const probed = await resolveFfmpegPath({ FFMPEG_PATH: '/nonexistent/dir/ffmpeg' });
    expect(probed).not.toBe('/nonexistent/dir/ffmpeg');
  });

  it('returns null when no candidate is executable', async () => {
    // 本机装有绝对路径候选（homebrew/系统 ffmpeg）时无法构造全失败场景。
    const absoluteCandidates = ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg'];
    if (absoluteCandidates.some(candidate => existsSync(candidate))) return;
    const previousPath = process.env.PATH;
    process.env.PATH = '';
    try {
      await expect(resolveFfmpegPath({})).resolves.toBeNull();
    } finally {
      process.env.PATH = previousPath;
    }
  });
});
