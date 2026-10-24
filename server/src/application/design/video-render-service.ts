// P6.4 视频渲染执行器（设计文档 §4）：headless Chromium screencast（JPEG）→
// ffmpeg image2pipe → stdout 分片 MP4。进程生命周期对齐 CommandTaskExecutor
// 模板（detached spawn + killProcessTree）。所有环境触点均经 VideoRenderDeps
// 注入，测试零真实 Chrome/ffmpeg。
import { spawn } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ChildProcess } from 'node:child_process';
import type { Browser, CDPSession, Page } from 'puppeteer-core';
import { defaultChromeDiscoveryDeps, resolveChromePath } from '../browser/chrome-discovery.js';
import { resolveDataDir } from '../../utils/data-dir.js';
import { killProcessTree } from '../../utils/process-tree.js';
import {
  MEDIA_GENERATED_VIDEO_MAX_BYTES,
  MEDIA_VIDEO_MAX_DURATION_MS,
  MEDIA_VIDEO_MAX_FPS,
  MEDIA_VIDEO_MAX_WIDTH,
  MEDIA_VIDEO_MIN_DURATION_MS,
  MEDIA_VIDEO_MIN_FPS,
  MEDIA_VIDEO_MIN_WIDTH,
  MediaTaskRunError,
  type DesignMediaProgress,
  type DesignMediaTaskParamsVideoRender,
  type DesignMediaTaskResult,
  type MediaExecutorContext,
  type MediaTaskExecution,
  type MediaTaskExecutor,
} from './media-types.js';

// ---------------------------------------------------------------------------
// 注入边界（§4.2）
// ---------------------------------------------------------------------------

export interface RenderPage {
  startScreencast(onFrame: (jpeg: Buffer) => void): Promise<void>;
  stopScreencast(): Promise<void>;
  close(): Promise<void>;
}

export interface RenderBrowser {
  openPage(url: string, viewport: { width: number; height: number }): Promise<RenderPage>;
  close(): Promise<void>;
}

export interface EncoderWaitResult {
  code: number | null;
  stdout: Buffer;
  /** 截尾 2 KiB 的 stderr 摘要。 */
  stderrTail: string;
}

export interface EncoderProcess {
  pid: number;
  /** 内建背压：底层 write 返回 false 时等待 drain 再 resolve。 */
  writeStdin(chunk: Buffer): Promise<void>;
  endStdin(): void;
  /** stdout MP4 字节（编码完成时 resolve）；stderrTail 截尾 2 KiB。 */
  wait(): Promise<EncoderWaitResult>;
}

/**
 * 视频执行器的环境依赖。saveOutput 为产物写入注入点：执行器没有
 * importAsset 访问权，saving 阶段把提交会话 id 与编码出的 MP4 字节交给
 * 注入方（L33 组装时绑 L31 的 createGeneratedAssetWriter；测试注入假实现）。
 * 因此本执行器要求 deps 必传（设计文档的 `deps?` 缺省真依赖在本卡裁决为
 * `defaultVideoRenderDeps()` 展开 + 必传 saveOutput，见 L33 装配）。
 */
export interface VideoRenderDeps {
  launchBrowser(): Promise<RenderBrowser>;
  resolveFfmpeg(): Promise<string | null>;
  /** args[0] 为 ffmpeg 可执行文件（§4.3 完整命令行首 token），其余为参数。 */
  spawnFfmpeg(args: string[], opts: { onStderr?: (chunk: string) => void }): EncoderProcess;
  killTree(pid: number): Promise<void>;
  saveOutput(sessionId: string, mp4Bytes: Buffer): Promise<{ path: string; bytes: number }>;
  /** 单调时钟（缺省 Date.now）：时隙节流用，注入供测试控制。 */
  now?: () => number;
}

// ---------------------------------------------------------------------------
// ffmpeg 探测（resolveFfmpegPath）
// ---------------------------------------------------------------------------

/** 100ms 量级的快速验证超时：`-version` 正常远快于该值，超时即判不可用。 */
const FFMPEG_PROBE_TIMEOUT_MS = 1000;

const FFMPEG_FALLBACK_CANDIDATES = [
  'ffmpeg',
  '/opt/homebrew/bin/ffmpeg',
  '/usr/local/bin/ffmpeg',
  '/usr/bin/ffmpeg',
];

/**
 * fs.access(X_OK) + spawn `-version` 双重验证；任一步失败即视为不可用。
 * 裸名候选（'ffmpeg'）跳过 access（相对 cwd 的 access 无意义），直接经
 * PATH spawn 验证。
 */
async function probeExecutable(candidate: string): Promise<boolean> {
  if (candidate.includes(path.sep)) {
    try {
      await access(candidate, fsConstants.X_OK);
    } catch {
      return false;
    }
  }
  return new Promise<boolean>(resolve => {
    let settled = false;
    const finish = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(ok);
    };
    const child = spawn(candidate, ['-version'], { stdio: 'ignore' });
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        // 进程已退出。
      }
      finish(false);
    }, FFMPEG_PROBE_TIMEOUT_MS);
    child.once('error', () => finish(false));
    child.once('close', code => finish(code === 0));
  });
}

/**
 * ffmpeg 发现顺序：FFMPEG_PATH（可执行验证）→ PATH → 常见 brew/系统路径。
 * 全部失败返回 null（调用方映射 RUNTIME_MISSING）。
 */
export async function resolveFfmpegPath(env: NodeJS.ProcessEnv): Promise<string | null> {
  const fromEnv = env.FFMPEG_PATH;
  if (fromEnv && (await probeExecutable(fromEnv))) return fromEnv;
  for (const candidate of FFMPEG_FALLBACK_CANDIDATES) {
    if (await probeExecutable(candidate)) return candidate;
  }
  return null;
}

// ---------------------------------------------------------------------------
// ffmpeg 参数（§4.3）
// ---------------------------------------------------------------------------

function ffmpegArgs(fps: number): string[] {
  return [
    '-y',
    '-f',
    'image2pipe',
    '-framerate',
    String(fps),
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
  ];
}

const STDERR_TAIL_BYTES = 2048;

/**
 * 真实 EncoderProcess：detached 子进程（供 killProcessTree 进程组击杀）、
 * stdin drain 背压、stdout 收集（收集中途超 256 MiB 立即 SIGKILL 并提前
 * settle，由执行器判「输出超过大小上限」）、stderr 只保留尾 2 KiB、
 * close/error 双监听（spawn 失败 → code:null + 空 stdout + 失败消息）。
 */
function encoderProcessFromChild(
  child: ChildProcess,
  opts: { onStderr?: (chunk: string) => void }
): EncoderProcess {
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: string[] = [];
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let overLimit = false;
  let settled = false;
  let settle!: (result: EncoderWaitResult) => void;
  const waitPromise = new Promise<EncoderWaitResult>(resolve => {
    settle = resolve;
  });
  const finish = (code: number | null): void => {
    if (settled) return;
    settled = true;
    settle({
      code,
      stdout: Buffer.concat(stdoutChunks),
      stderrTail: stderrChunks.join('').slice(-STDERR_TAIL_BYTES),
    });
  };

  child.once('error', err => {
    if (settled) return;
    settled = true;
    settle({
      code: null,
      stdout: Buffer.alloc(0),
      stderrTail: `spawn failed: ${err.message}`,
    });
  });
  child.once('close', code => finish(code ?? null));

  child.stdout?.on('data', (chunk: Buffer) => {
    if (overLimit) return;
    stdoutChunks.push(chunk);
    stdoutBytes += chunk.length;
    if (stdoutBytes > MEDIA_GENERATED_VIDEO_MAX_BYTES) {
      // 收集中途超限：立即终止编码进程并提前返回（§4.3），避免无界缓冲。
      overLimit = true;
      try {
        child.kill('SIGKILL');
      } catch {
        // 进程已退出。
      }
      finish(null);
    }
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf8');
    opts.onStderr?.(text);
    stderrChunks.push(text);
    stderrBytes += text.length;
    while (stderrBytes > STDERR_TAIL_BYTES && stderrChunks.length > 1) {
      const dropped = stderrChunks.shift();
      if (dropped) stderrBytes -= dropped.length;
    }
  });
  // 编码进程死亡后 endStdin()/write() 会触发 EPIPE：挂常驻 no-op 监听兜底，
  // 避免未处理的 'error' 事件打崩进程；挂起中的写入仍由 writeStdin 自己的
  // 一次性 error 监听收口。
  child.stdin?.on('error', () => {});

  return {
    // spawn 失败时 pid 为 undefined：占位为不可能存在的 pid（kill 必然
    // ESRCH 的安全 no-op），避免 0/-1 触发进程组语义。
    pid: child.pid ?? Number.MAX_SAFE_INTEGER,
    writeStdin(chunk: Buffer): Promise<void> {
      const stdin = child.stdin;
      if (!stdin || stdin.destroyed || !stdin.writable) return Promise.resolve();
      return new Promise<void>((resolve, reject) => {
        if (stdin.write(chunk)) {
          resolve();
          return;
        }
        const onDrain = (): void => {
          cleanup();
          resolve();
        };
        const onError = (err: Error): void => {
          cleanup();
          reject(err);
        };
        const cleanup = (): void => {
          stdin.off('drain', onDrain);
          stdin.off('error', onError);
        };
        stdin.once('drain', onDrain);
        stdin.once('error', onError);
      });
    },
    endStdin(): void {
      child.stdin?.end();
    },
    wait: () => waitPromise,
  };
}

/** 默认 spawnFfmpeg：args[0] 为 ffmpeg 可执行文件（§4.3 完整命令行）。 */
export function defaultSpawnFfmpeg(
  args: string[],
  opts: { onStderr?: (chunk: string) => void } = {}
): EncoderProcess {
  const child = spawn(args[0]!, args.slice(1), {
    detached: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return encoderProcessFromChild(child, opts);
}

// ---------------------------------------------------------------------------
// 默认浏览器依赖（puppeteer-core + 既有 Chrome 发现基础设施）
// ---------------------------------------------------------------------------

const PAGE_STABILIZE_MS = 300;

// puppeteer-core 25.3.0 版本依据：公开 API 无 page.startScreencast(callback)
// （公开面只有 page.screencast(): Promise<ScreenRecorder>，webm 导向；见
// node_modules/puppeteer-core/src/api/Page.ts）。JPEG 帧回调按 CDP 原语实现：
// Page.startScreencast {format:'jpeg', quality:90} + Page.screencastFrame 事件
// （payload {data: base64 字符串, metadata, sessionId}，须回
// Page.screencastFrameAck {sessionId} 才会持续收帧）+ Page.stopScreencast。
// 同款用法已在 browser 域 puppeteer-engine.ts 验证。
class CdpScreencastPage implements RenderPage {
  private client: CDPSession | null = null;
  private handler: ((payload: {
    data: string;
    metadata: { timestamp?: number };
    sessionId: number;
  }) => void) | null = null;

  constructor(private readonly page: Page) {}

  async startScreencast(onFrame: (jpeg: Buffer) => void): Promise<void> {
    const client = await this.page.createCDPSession();
    this.client = client;
    this.handler = (payload): void => {
      // 先 ack 再回调，Chromium 才会继续推帧。
      void client.send('Page.screencastFrameAck', { sessionId: payload.sessionId }).catch(() => {});
      onFrame(Buffer.from(payload.data, 'base64'));
    };
    client.on('Page.screencastFrame', this.handler);
    await client.send('Page.startScreencast', { format: 'jpeg', quality: 90 });
  }

  async stopScreencast(): Promise<void> {
    const client = this.client;
    if (!client) return;
    this.client = null;
    if (this.handler) {
      client.off('Page.screencastFrame', this.handler);
      this.handler = null;
    }
    await client.send('Page.stopScreencast').catch(() => {});
    await client.detach().catch(() => {});
  }

  close(): Promise<void> {
    return this.page.close();
  }
}

class PuppeteerRenderBrowser implements RenderBrowser {
  constructor(private readonly browser: Browser) {}

  async openPage(url: string, viewport: { width: number; height: number }): Promise<RenderPage> {
    const page = await this.browser.newPage();
    try {
      await page.setViewport({ width: viewport.width, height: viewport.height });
      await page.goto(url, { waitUntil: 'load' });
      // 300ms 稳定等待：load 事件后让首帧样式/动画就绪（§4.4）。
      await new Promise(resolve => setTimeout(resolve, PAGE_STABILIZE_MS));
    } catch (err) {
      await page.close().catch(() => {});
      throw err;
    }
    return new CdpScreencastPage(page);
  }

  close(): Promise<void> {
    return this.browser.close();
  }
}

/** 与 browser 域同款 engine cache 目录（server.ts 的 dataDir/browsers）。 */
function defaultLaunchBrowser(): Promise<RenderBrowser> {
  return (async () => {
    const chromePath = await resolveChromePath(
      defaultChromeDiscoveryDeps(path.join(resolveDataDir(), 'browsers'))
    );
    if (!chromePath) {
      throw new MediaTaskRunError(
        'RUNTIME_MISSING',
        'No usable Chrome/Chromium found. Install a browser engine in Settings, or set ZCLAUDIA_CHROME_PATH to an existing Chrome executable and retry.'
      );
    }
    const puppeteer = (await import('puppeteer-core')).default;
    const browser = await puppeteer.launch({
      executablePath: chromePath,
      headless: true,
      args: ['--mute-audio', '--disable-dev-shm-usage'],
    });
    return new PuppeteerRenderBrowser(browser);
  })();
}

/**
 * 默认真依赖（不含 saveOutput）。L33 装配：
 * `createVideoRenderExecutor({ ...defaultVideoRenderDeps(), saveOutput })`。
 */
export function defaultVideoRenderDeps(): Omit<VideoRenderDeps, 'saveOutput'> {
  return {
    launchBrowser: () => defaultLaunchBrowser(),
    resolveFfmpeg: () => resolveFfmpegPath(process.env),
    spawnFfmpeg: defaultSpawnFfmpeg,
    killTree: async pid => {
      await killProcessTree(pid);
    },
    now: () => Date.now(),
  };
}

// ---------------------------------------------------------------------------
// 执行器编排（§4.4）
// ---------------------------------------------------------------------------

/** 输出大小上限的纯判定（可测：limit 参数供测试注入小上限）。 */
export function assertOutputWithinLimit(
  bytes: Buffer,
  limit: number = MEDIA_GENERATED_VIDEO_MAX_BYTES
): void {
  if (bytes.length > limit) {
    throw new MediaTaskRunError(
      'ENCODE_FAILED',
      `Output exceeded the size limit (${limit} bytes); encoding was terminated.`
    );
  }
}

function assertVideoParams(execution: MediaTaskExecution): DesignMediaTaskParamsVideoRender {
  const params = execution.params;
  if (params.type !== 'video-render') {
    throw new MediaTaskRunError('INTERNAL', 'Task parameters do not match the video-render executor');
  }
  const evenDimensions =
    Number.isInteger(params.width) &&
    Number.isInteger(params.height) &&
    params.width >= MEDIA_VIDEO_MIN_WIDTH &&
    params.width <= MEDIA_VIDEO_MAX_WIDTH &&
    params.height >= MEDIA_VIDEO_MIN_WIDTH &&
    params.height <= MEDIA_VIDEO_MAX_WIDTH &&
    params.width % 2 === 0 &&
    params.height % 2 === 0;
  if (!evenDimensions) {
    throw new MediaTaskRunError(
      'RENDER_FAILED',
      `Invalid video parameters: width and height must be even numbers between ${MEDIA_VIDEO_MIN_WIDTH} and ${MEDIA_VIDEO_MAX_WIDTH} (got ${params.width}x${params.height}).`
    );
  }
  if (
    !Number.isInteger(params.fps) ||
    params.fps < MEDIA_VIDEO_MIN_FPS ||
    params.fps > MEDIA_VIDEO_MAX_FPS
  ) {
    throw new MediaTaskRunError(
      'RENDER_FAILED',
      `Invalid video parameters: frame rate must be between ${MEDIA_VIDEO_MIN_FPS} and ${MEDIA_VIDEO_MAX_FPS} (got ${params.fps}).`
    );
  }
  if (
    !Number.isInteger(params.durationMs) ||
    params.durationMs < MEDIA_VIDEO_MIN_DURATION_MS ||
    params.durationMs > MEDIA_VIDEO_MAX_DURATION_MS
  ) {
    throw new MediaTaskRunError(
      'RENDER_FAILED',
      `Invalid video parameters: duration must be between ${MEDIA_VIDEO_MIN_DURATION_MS} and ${MEDIA_VIDEO_MAX_DURATION_MS} ms (got ${params.durationMs}).`
    );
  }
  if (typeof params.entryPath !== 'string' || params.entryPath.trim().length === 0) {
    throw new MediaTaskRunError('RENDER_FAILED', 'Invalid video parameters: missing entry file path.');
  }
  return params;
}

function wrapRuntimeError(err: unknown, prefix: string): MediaTaskRunError {
  if (err instanceof MediaTaskRunError) return err;
  const message = err instanceof Error ? err.message : String(err);
  return new MediaTaskRunError('RENDER_FAILED', `${prefix}: ${message}`);
}

function summarizeStderr(stderrTail: string): string {
  const condensed = stderrTail.replace(/\s+/g, ' ').trim();
  if (condensed.length === 0) return ' (no stderr output)';
  return condensed.length > 200 ? `${condensed.slice(0, 200)}…` : condensed;
}

const RENDER_POLL_INTERVAL_MS = 50;

export function createVideoRenderExecutor(deps: VideoRenderDeps): MediaTaskExecutor {
  return async (execution: MediaTaskExecution, ctx: MediaExecutorContext): Promise<DesignMediaTaskResult> => {
    const params = assertVideoParams(execution);

    let browser: RenderBrowser | null = null;
    let page: RenderPage | null = null;
    let encoder: EncoderProcess | null = null;

    const report = async (update: DesignMediaProgress): Promise<void> => {
      try {
        await ctx.onProgress(update);
      } catch {
        // 进度失败静默（§1.4），不中断执行。
      }
    };

    const closeQuietly = async (step: () => Promise<void>): Promise<void> => {
      try {
        await step();
      } catch {
        // 页面/浏览器/采集关闭失败不影响既得结果，也不改变失败语义。
      }
    };

    // §4.4 取消路径：停 screencast → 关浏览器 → killTree → await wait()（忽略结果）。
    const cleanup = async (): Promise<void> => {
      if (page) await closeQuietly(() => page!.stopScreencast());
      if (page) await closeQuietly(() => page!.close());
      if (browser) await closeQuietly(() => browser!.close());
      if (encoder) {
        try {
          await deps.killTree(encoder.pid);
        } catch {
          // 进程可能已退出。
        }
        await closeQuietly(() => encoder!.wait().then(() => undefined));
      }
    };

    const ensureNotAborted = (): void => {
      if (ctx.signal.aborted) throw new MediaTaskRunError('ABORTED', 'Canceled');
    };

    // 帧回调：按目标帧率开时隙（密帧丢弃到槽率），串行写入链（背压安全）。
    // 写入失败——如 ffmpeg 提前退出——丢帧继续，结果由 wait() 收口。
    // 时隙 + 目标帧数语义（真实冒烟修正）：image2pipe 给每帧固定 1/fps 时长，
    // 不做节流时采集帧率高于目标会造成等比慢放；停止后不足目标帧数用尾帧补齐，
    // 静态页也能得到请求时长。写入总数恒等于 targetFrames → 时长恒等于请求值。
    const now = deps.now ?? Date.now;
    const slotIntervalMs = 1000 / params.fps;
    const targetFrames = Math.max(1, Math.round((params.durationMs * params.fps) / 1000));
    let written = 0;
    let lastFrame: Buffer | null = null;
    let nextSlotAt = 0;
    let targetReached = false;
    let writeChain: Promise<void> = Promise.resolve();
    const writeFrame = (jpeg: Buffer): void => {
      writeChain = writeChain
        .then(() => {
          if (ctx.signal.aborted || !encoder) return;
          return encoder.writeStdin(jpeg);
        })
        .catch(() => {
          // stdin 已关闭：丢弃该帧。
        });
    };
    const onFrame = (jpeg: Buffer): void => {
      if (targetReached) return;
      const at = now();
      if (written > 0 && at < nextSlotAt) return;
      nextSlotAt = at + slotIntervalMs;
      written += 1;
      lastFrame = jpeg;
      writeFrame(jpeg);
      if (written % 10 === 0) {
        void report({ phase: 'rendering', frames: written });
      }
      if (written >= targetFrames) targetReached = true;
    };

    try {
      ensureNotAborted();
      await report({ phase: 'launching' });

      // 入口文件：containment 解析 + 常规文件校验（§4.4 步骤 2）。
      const entryAbsolute = await ctx.resolveWorkspacePath(params.entryPath);
      let entryStat: Awaited<ReturnType<typeof stat>>;
      try {
        entryStat = await stat(entryAbsolute);
      } catch {
        throw new MediaTaskRunError(
          'ENTRY_UNREADABLE',
          `Video entry does not exist or is not readable: ${params.entryPath}`
        );
      }
      if (!entryStat.isFile()) {
        throw new MediaTaskRunError(
          'ENTRY_UNREADABLE',
          `Video entry is not a regular file: ${params.entryPath}`
        );
      }
      ensureNotAborted();

      const ffmpegPath = await deps.resolveFfmpeg();
      if (!ffmpegPath) {
        throw new MediaTaskRunError(
          'RUNTIME_MISSING',
          'ffmpeg not found. Install ffmpeg (e.g. brew install ffmpeg) or set FFMPEG_PATH, then retry.'
        );
      }
      ensureNotAborted();

      encoder = deps.spawnFfmpeg([ffmpegPath, ...ffmpegArgs(params.fps)], {});
      ensureNotAborted();

      try {
        browser = await deps.launchBrowser();
      } catch (err) {
        throw wrapRuntimeError(err, 'Failed to launch the browser');
      }
      ensureNotAborted();

      const pageUrl = pathToFileURL(entryAbsolute).href;
      try {
        page = await browser.openPage(pageUrl, { width: params.width, height: params.height });
      } catch (err) {
        throw wrapRuntimeError(err, 'Failed to load the page');
      }
      ensureNotAborted();

      await report({ phase: 'rendering', frames: 0 });
      await page.startScreencast(onFrame);

      // 墙钟截止从 screencast 启动起算；密帧场景写满 targetFrames 提前结束。
      const deadline = now() + params.durationMs;
      while (!targetReached && now() < deadline) {
        ensureNotAborted();
        const remaining = deadline - now();
        await new Promise(resolve =>
          setTimeout(resolve, Math.max(0, Math.min(RENDER_POLL_INTERVAL_MS, remaining)))
        );
      }
      ensureNotAborted();

      await closeQuietly(() => page!.stopScreencast());
      if (written === 0) {
        throw new MediaTaskRunError('RENDER_FAILED', 'The page produced no video frames');
      }
      // 稀疏补齐：不足目标帧数时以尾帧填充剩余时隙（时长 = 请求值）。
      while (!targetReached && written < targetFrames && lastFrame) {
        written += 1;
        writeFrame(lastFrame);
      }

      await closeQuietly(() => page!.close());
      await closeQuietly(() => browser!.close());
      // 冲刷背压中的待写帧（若编码进程已死，wait() 先 resolve，不悬挂）。
      await Promise.race([writeChain, encoder.wait()]);
      encoder.endStdin();

      await report({ phase: 'encoding' });
      const encoded = await encoder.wait();
      ensureNotAborted();

      assertOutputWithinLimit(encoded.stdout);
      if (encoded.code !== 0) {
        throw new MediaTaskRunError(
          'ENCODE_FAILED',
          `ffmpeg encoding failed (exit code ${encoded.code}): ${summarizeStderr(encoded.stderrTail)}`
        );
      }
      if (encoded.stdout.length === 0) {
        throw new MediaTaskRunError('ENCODE_FAILED', 'ffmpeg produced no output data');
      }

      await report({ phase: 'saving' });
      let saved: { path: string; bytes: number };
      try {
        saved = await deps.saveOutput(execution.sessionId ?? '', encoded.stdout);
      } catch (err) {
        if (err instanceof MediaTaskRunError) throw err;
        const message = err instanceof Error ? err.message : String(err);
        throw new MediaTaskRunError('ASSET_WRITE_FAILED', `Failed to write the video artifact: ${message}`);
      }
      return { path: saved.path, bytes: saved.bytes, mime: 'video/mp4', usage: null };
    } catch (err) {
      await cleanup();
      if (err instanceof MediaTaskRunError && err.code === 'ABORTED') throw err;
      if (ctx.signal.aborted) throw new MediaTaskRunError('ABORTED', 'Canceled');
      throw err;
    }
  };
}
