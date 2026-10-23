// P6.2 图片 provider：OpenAI 兼容 `/images/generations` 与 `/images/edits`（L30）。
// 设计文档：docs/plans/2026-10-24-design-workbench-p6-implementation.md §2。
// fetch / 超时均可注入，测试零真实网络；apiKey 只进请求头，绝不进入日志或异常消息。

import {
  MediaProviderError,
  type DesignMediaUsage,
  type MediaImageProvider,
  type MediaImageResult,
} from './media-types.js';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_TIMEOUT_MS = 180_000;
const DOWNLOAD_TIMEOUT_MS = 60_000;
const DOWNLOAD_MAX_BYTES = 10 * 1024 * 1024;
const ERROR_BODY_SNIPPET_CHARS = 200;
/** edit multipart 的 image 部件名（按源图 mime 给扩展名；未知 mime 兜底 png）。 */
const EDIT_IMAGE_PART_NAMES: Record<string, string> = {
  'image/png': 'image.png',
  'image/jpeg': 'image.jpg',
  'image/webp': 'image.webp',
};

export interface OpenAiImagesProviderConfig {
  /** 上游 API 根（缺省 https://api.openai.com/v1），尾斜杠剥离后拼接端点路径。 */
  baseUrl?: string;
  /** 图片模型 id，写入请求体 `model` 字段（L33 以 provider ref 的 model 组装时传入）。 */
  model: string;
  apiKey: string;
  /** 附加请求头，合并到缺省头之后（可覆盖，与 models-fetch.ts 惯例一致）。 */
  requestHeaders?: Record<string, string>;
  /** 注入测试用；缺省 globalThis.fetch。 */
  fetchImpl?: typeof fetch;
  /** 主请求超时（毫秒，缺省 180_000）；url 下载固定 60s。 */
  timeoutMs?: number;
}

/** 把外部 signal 与超时定时器组合成一个内部 controller；记录是否因超时中止。 */
interface ComposedSignal {
  signal: AbortSignal;
  timedOut: boolean;
  cleanup(): void;
}

function composeSignal(external: AbortSignal, timeoutMs: number): ComposedSignal {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const onExternalAbort = () => controller.abort();
  const composed: ComposedSignal = {
    signal: controller.signal,
    timedOut: false,
    cleanup() {
      if (timer !== undefined) clearTimeout(timer);
      external.removeEventListener('abort', onExternalAbort);
    },
  };
  if (external.aborted) {
    controller.abort();
  } else {
    external.addEventListener('abort', onExternalAbort);
  }
  if (timeoutMs > 0) {
    timer = setTimeout(() => {
      composed.timedOut = true;
      controller.abort();
    }, timeoutMs);
  }
  return composed;
}

/** 收口 fetch / 解析阶段的异常：外部中止优先于超时，再落 provider-error。 */
function toProviderError(
  err: unknown,
  external: AbortSignal,
  timedOut: boolean,
  action: string
): MediaProviderError {
  if (external.aborted) return new MediaProviderError('provider-aborted', '请求已取消');
  if (timedOut) return new MediaProviderError('provider-timeout', `${action}超时`);
  const message = err instanceof Error ? err.message : String(err);
  return new MediaProviderError('provider-error', `${action}失败：${message}`);
}

function normalizeUsage(raw: unknown): DesignMediaUsage | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const num = (value: unknown) =>
    typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  const inputTokens = num(record.input_tokens);
  const outputTokens = num(record.output_tokens);
  const totalCostUsd = num(record.total_cost);
  if (inputTokens === undefined && outputTokens === undefined && totalCostUsd === undefined) {
    return null;
  }
  const usage: DesignMediaUsage = {};
  if (inputTokens !== undefined) usage.inputTokens = inputTokens;
  if (outputTokens !== undefined) usage.outputTokens = outputTokens;
  if (totalCostUsd !== undefined) usage.totalCostUsd = totalCostUsd;
  return usage;
}

/** magic bytes → mime；不识别返回 null（PNG / JPEG / WebP）。 */
function detectImageMime(bytes: Buffer): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 12 &&
    bytes.toString('latin1', 0, 4) === 'RIFF' &&
    bytes.toString('latin1', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

function finishImage(bytes: Buffer, usage: DesignMediaUsage | null): MediaImageResult {
  const mime = detectImageMime(bytes);
  if (!mime) {
    throw new MediaProviderError('provider-error', '服务返回了无法识别的图片格式');
  }
  return { bytes, mime, usage };
}

/** 拒绝 hostname 为 localhost / *.local / 回环与私网字面量（172.16–31 精确到段）。 */
function assertPublicHost(hostname: string): void {
  const host = hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  const deny = (reason: string) => {
    throw new MediaProviderError('provider-error', `图片下载地址不允许${reason}（${hostname}）`);
  };
  if (host === 'localhost' || host.endsWith('.local')) deny('指向内网主机');
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4) {
    const first = Number(ipv4[1]);
    const second = Number(ipv4[2]);
    const private4 =
      first === 127 ||
      first === 10 ||
      first === 0 ||
      (first === 192 && second === 168) ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31);
    if (private4) deny('指向私网地址');
    return;
  }
  if (host === '::1' || host === '0:0:0:0:0:0:0:1') deny('指向回环地址');
}

/** 读取响应体，超过 maxBytes 立即中止并报错。 */
async function readBoundedBody(res: Response, maxBytes: number): Promise<Buffer> {
  const reader = res.body?.getReader();
  if (!reader) {
    throw new MediaProviderError('provider-error', '下载响应没有可读内容');
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new MediaProviderError(
        'provider-error',
        `下载的图片超过 ${Math.floor(maxBytes / 1024 / 1024)} MiB 上限`
      );
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

interface ParseContext {
  externalSignal: AbortSignal;
  fetchImpl: typeof fetch;
  timedOut: () => boolean;
  editEndpoint: boolean;
}

async function downloadImage(url: string, ctx: ParseContext): Promise<Buffer> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new MediaProviderError('provider-error', '图片下载地址无效');
  }
  if (parsed.protocol !== 'https:') {
    throw new MediaProviderError('provider-error', '图片下载地址必须为 https');
  }
  assertPublicHost(parsed.hostname);
  const composed = composeSignal(ctx.externalSignal, DOWNLOAD_TIMEOUT_MS);
  try {
    const res = await ctx.fetchImpl(parsed.toString(), { method: 'GET', signal: composed.signal });
    if (!res.ok) {
      throw new MediaProviderError(
        'provider-error',
        `下载图片失败：服务返回 ${res.status}`,
        res.status
      );
    }
    return await readBoundedBody(res, DOWNLOAD_MAX_BYTES);
  } catch (err) {
    if (ctx.externalSignal.aborted) {
      throw new MediaProviderError('provider-aborted', '请求已取消');
    }
    if (err instanceof MediaProviderError) throw err;
    // 用下载自身的超时标志：60s 下载超时应映射 provider-timeout，而非
    // 携带原生 AbortError 消息的 provider-error（外部中止已在上方优先收口）。
    throw toProviderError(err, ctx.externalSignal, composed.timedOut, '下载图片');
  } finally {
    composed.cleanup();
  }
}

async function parseImageResponse(res: Response, ctx: ParseContext): Promise<MediaImageResult> {
  if (!res.ok) {
    const snippet = (await res.text().catch(() => '')).slice(0, ERROR_BODY_SNIPPET_CHARS);
    if (ctx.editEndpoint && (res.status === 404 || res.status === 405)) {
      throw new MediaProviderError('provider-unsupported', '当前服务不支持图片编辑', res.status);
    }
    throw new MediaProviderError(
      'provider-error',
      `图片服务返回 ${res.status}${snippet ? `：${snippet}` : ''}`,
      res.status
    );
  }
  let payload: unknown;
  try {
    payload = await res.json();
  } catch (err) {
    throw toProviderError(err, ctx.externalSignal, ctx.timedOut(), '解析图片服务响应');
  }
  const record = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
  const data = Array.isArray(record.data) ? record.data : [];
  const row =
    data.length > 0 && data[0] && typeof data[0] === 'object'
      ? (data[0] as Record<string, unknown>)
      : null;
  const usage = normalizeUsage(record.usage);
  if (!row) {
    throw new MediaProviderError(
      'provider-error',
      '服务响应缺少图片数据（data[0]）',
      res.status
    );
  }
  if (typeof row.b64_json === 'string' && row.b64_json.length > 0) {
    return finishImage(Buffer.from(row.b64_json, 'base64'), usage);
  }
  if (typeof row.url === 'string' && row.url.length > 0) {
    return finishImage(await downloadImage(row.url, ctx), usage);
  }
  throw new MediaProviderError(
    'provider-error',
    '服务响应未包含图片数据（b64_json/url 均缺失）',
    res.status
  );
}

export function createOpenAiImagesProvider(config: OpenAiImagesProviderConfig): MediaImageProvider {
  const baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  const { model, apiKey } = config;
  const extraHeaders = config.requestHeaders ?? {};
  const fetchImpl = config.fetchImpl ?? globalThis.fetch;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const provider: MediaImageProvider = {
    info: {
      id: 'openai-images',
      label: 'OpenAI 兼容图片服务',
      capabilities: ['generate', 'edit'],
    },

    async generate(input) {
      if (input.signal.aborted) {
        throw new MediaProviderError('provider-aborted', '请求已取消');
      }
      const composed = composeSignal(input.signal, timeoutMs);
      try {
        const body: Record<string, unknown> = { model, prompt: input.prompt, n: 1 };
        if (input.size) body.size = input.size;
        const res = await fetchImpl(`${baseUrl}/images/generations`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
            ...extraHeaders,
          },
          body: JSON.stringify(body),
          signal: composed.signal,
        });
        return await parseImageResponse(res, {
          externalSignal: input.signal,
          fetchImpl,
          timedOut: () => composed.timedOut,
          editEndpoint: false,
        });
      } catch (err) {
        if (err instanceof MediaProviderError) throw err;
        throw toProviderError(err, input.signal, composed.timedOut, '请求图片服务');
      } finally {
        composed.cleanup();
      }
    },

    async edit(input) {
      if (input.signal.aborted) {
        throw new MediaProviderError('provider-aborted', '请求已取消');
      }
      const composed = composeSignal(input.signal, timeoutMs);
      try {
      const form = new FormData();
      form.append('model', model);
      form.append('prompt', input.prompt);
      if (input.size) form.append('size', input.size);
      // 部件名带扩展名：undici 无名 Blob 会发 filename="blob"，部分上游会拒收。
      const imagePartName = EDIT_IMAGE_PART_NAMES[input.source.mime] ?? 'image.png';
      form.append(
        'image',
        new Blob([input.source.bytes], { type: input.source.mime }),
        imagePartName
      );
        const res = await fetchImpl(`${baseUrl}/images/edits`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            ...extraHeaders,
          },
          body: form,
          signal: composed.signal,
        });
        return await parseImageResponse(res, {
          externalSignal: input.signal,
          fetchImpl,
          timedOut: () => composed.timedOut,
          editEndpoint: true,
        });
      } catch (err) {
        if (err instanceof MediaProviderError) throw err;
        throw toProviderError(err, input.signal, composed.timedOut, '请求图片服务');
      } finally {
        composed.cleanup();
      }
    },
  };

  return provider;
}
