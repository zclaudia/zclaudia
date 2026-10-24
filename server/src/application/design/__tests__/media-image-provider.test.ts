// L30 图片 provider 测试：fetch 全注入假实现，零真实网络。
// 覆盖设计文档 §2：b64/url 两形态、私网拒绝、magic bytes、错误映射、超时/中止、usage 归一、请求体形状。

import { describe, expect, it } from 'vitest';
import {
  createOpenAiImagesProvider,
  type OpenAiImagesProviderConfig,
} from '../media-image-provider.js';
import { MediaProviderError, type MediaProviderErrorCode } from '../media-types.js';

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const WEBP_BYTES = Buffer.concat([
  Buffer.from('RIFF', 'latin1'),
  Buffer.from([0x14, 0x00, 0x00, 0x00]),
  Buffer.from('WEBP', 'latin1'),
  Buffer.from([0x00, 0x00, 0x00, 0x00]),
]);

const IDLE_SIGNAL = new AbortController().signal;
const EDIT_SOURCE = { path: 'design/assets/source.png', mime: 'image/png', bytes: PNG_BYTES };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function bytesResponse(bytes: Buffer, status = 200): Response {
  return new Response(new Uint8Array(bytes), { status });
}

interface RecordedCall {
  url: string;
  init: RequestInit;
}

function recordingFetch(
  respond: (url: string, init: RequestInit) => Response
): { calls: RecordedCall[]; fetch: typeof fetch } {
  const calls: RecordedCall[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const recordedInit = init ?? {};
    calls.push({ url, init: recordedInit });
    return respond(url, recordedInit);
  }) as typeof fetch;
  return { calls, fetch: impl };
}

/** 挂起直到组合 signal 中止（模拟慢上游），从不主动返回响应。 */
function hangingFetch(): typeof fetch {
  return ((_input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
    new Promise((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) return;
      if (signal.aborted) {
        reject(signal.reason);
        return;
      }
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    })) as typeof fetch;
}

function makeProvider(
  fetchImpl: typeof fetch,
  overrides: Partial<OpenAiImagesProviderConfig> = {}
) {
  return createOpenAiImagesProvider({
    apiKey: 'sk-test-key',
    model: 'cogview-4',
    fetchImpl,
    timeoutMs: 5_000,
    ...overrides,
  });
}

async function expectProviderError(
  promise: Promise<unknown>,
  expected: { code: MediaProviderErrorCode; status?: number; message?: string }
): Promise<MediaProviderError> {
  let caught: unknown;
  try {
    await promise;
  } catch (err) {
    caught = err;
  }
  expect(caught, 'expected the promise to reject with MediaProviderError').toBeInstanceOf(
    MediaProviderError
  );
  const err = caught as MediaProviderError;
  expect(err.code).toBe(expected.code);
  if (expected.status !== undefined) expect(err.status).toBe(expected.status);
  if (expected.message !== undefined) expect(err.message).toContain(expected.message);
  return err;
}

describe('createOpenAiImagesProvider', () => {
  it('exposes the openai-images provider info', () => {
    const { fetch: impl } = recordingFetch(() => jsonResponse({ data: [] }));
    expect(makeProvider(impl).info).toEqual({
      id: 'openai-images',
      label: 'OpenAI-compatible image service',
      capabilities: ['generate', 'edit'],
    });
  });

  describe('generate request shape', () => {
    it('posts JSON with model/prompt/n=1, no response_format, bearer auth and a stripped trailing slash', async () => {
      const { calls, fetch: impl } = recordingFetch(() =>
        jsonResponse({ data: [{ b64_json: PNG_BYTES.toString('base64') }] })
      );
      const provider = makeProvider(impl, { baseUrl: 'https://api.example.com/v1/' });
      await provider.generate({ prompt: '一只橘猫', signal: IDLE_SIGNAL });
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe('https://api.example.com/v1/images/generations');
      expect(calls[0].init.method).toBe('POST');
      const headers = calls[0].init.headers as Record<string, string>;
      expect(headers.Authorization).toBe('Bearer sk-test-key');
      expect(headers['Content-Type']).toBe('application/json');
      const body = JSON.parse(calls[0].init.body as string);
      expect(body).toEqual({ model: 'cogview-4', prompt: '一只橘猫', n: 1 });
      expect(body).not.toHaveProperty('response_format');
    });

    it('includes size only when provided', async () => {
      const withSize = recordingFetch(() =>
        jsonResponse({ data: [{ b64_json: PNG_BYTES.toString('base64') }] })
      );
      await makeProvider(withSize.fetch).generate({
        prompt: 'p',
        size: '1024x1024',
        signal: IDLE_SIGNAL,
      });
      expect(JSON.parse(withSize.calls[0].init.body as string)).toEqual({
        model: 'cogview-4',
        prompt: 'p',
        n: 1,
        size: '1024x1024',
      });
      const withoutSize = recordingFetch(() =>
        jsonResponse({ data: [{ b64_json: PNG_BYTES.toString('base64') }] })
      );
      await makeProvider(withoutSize.fetch).generate({ prompt: 'p', signal: IDLE_SIGNAL });
      expect(JSON.parse(withoutSize.calls[0].init.body as string)).toEqual({
        model: 'cogview-4',
        prompt: 'p',
        n: 1,
      });
    });

    it('defaults the base url to the OpenAI v1 endpoint', async () => {
      const { calls, fetch: impl } = recordingFetch(() =>
        jsonResponse({ data: [{ b64_json: PNG_BYTES.toString('base64') }] })
      );
      await makeProvider(impl).generate({ prompt: 'p', signal: IDLE_SIGNAL });
      expect(calls[0].url).toBe('https://api.openai.com/v1/images/generations');
    });

    it('merges requestHeaders after the defaults', async () => {
      const { calls, fetch: impl } = recordingFetch(() =>
        jsonResponse({ data: [{ b64_json: PNG_BYTES.toString('base64') }] })
      );
      const provider = makeProvider(impl, { requestHeaders: { 'X-Custom': 'yes' } });
      await provider.generate({ prompt: 'p', signal: IDLE_SIGNAL });
      const headers = calls[0].init.headers as Record<string, string>;
      expect(headers['X-Custom']).toBe('yes');
      expect(headers.Authorization).toBe('Bearer sk-test-key');
    });
  });

  describe('response parsing', () => {
    it('decodes a b64_json payload and keeps usage', async () => {
      const { fetch: impl } = recordingFetch(() =>
        jsonResponse({
          data: [{ b64_json: PNG_BYTES.toString('base64') }],
          usage: { input_tokens: 12, output_tokens: 34, total_cost: 0.05 },
        })
      );
      const result = await makeProvider(impl).generate({ prompt: 'p', signal: IDLE_SIGNAL });
      expect(result.bytes.equals(PNG_BYTES)).toBe(true);
      expect(result.mime).toBe('image/png');
      expect(result.usage).toEqual({ inputTokens: 12, outputTokens: 34, totalCostUsd: 0.05 });
    });

    it('downloads the image when the response carries a url', async () => {
      const { calls, fetch: impl } = recordingFetch(url => {
        if (url.endsWith('/images/generations')) {
          return jsonResponse({ data: [{ url: 'https://cdn.example.com/pic.png' }] });
        }
        return bytesResponse(PNG_BYTES);
      });
      const result = await makeProvider(impl).generate({ prompt: 'p', signal: IDLE_SIGNAL });
      expect(calls).toHaveLength(2);
      expect(calls[1].url).toBe('https://cdn.example.com/pic.png');
      expect(calls[1].init.method).toBe('GET');
      expect(result.bytes.equals(PNG_BYTES)).toBe(true);
      expect(result.mime).toBe('image/png');
      expect(result.usage).toBeNull();
    });

    it('prefers b64_json when both shapes are present', async () => {
      const { calls, fetch: impl } = recordingFetch(() =>
        jsonResponse({
          data: [
            {
              b64_json: PNG_BYTES.toString('base64'),
              url: 'https://cdn.example.com/pic.png',
            },
          ],
        })
      );
      const result = await makeProvider(impl).generate({ prompt: 'p', signal: IDLE_SIGNAL });
      expect(calls).toHaveLength(1);
      expect(result.bytes.equals(PNG_BYTES)).toBe(true);
    });

    it.each([
      ['png', PNG_BYTES, 'image/png'],
      ['jpeg', JPEG_BYTES, 'image/jpeg'],
      ['webp', WEBP_BYTES, 'image/webp'],
    ])('detects %s via magic bytes', async (_name, bytes, mime) => {
      const { fetch: impl } = recordingFetch(() =>
        jsonResponse({ data: [{ b64_json: bytes.toString('base64') }] })
      );
      const result = await makeProvider(impl).generate({ prompt: 'p', signal: IDLE_SIGNAL });
      expect(result.mime).toBe(mime);
      expect(result.bytes.equals(bytes)).toBe(true);
    });

    it('rejects unrecognized image payloads', async () => {
      const gif = Buffer.from('GIF89a0102', 'latin1');
      const { fetch: impl } = recordingFetch(() =>
        jsonResponse({ data: [{ b64_json: gif.toString('base64') }] })
      );
      await expectProviderError(makeProvider(impl).generate({ prompt: 'p', signal: IDLE_SIGNAL }), {
        code: 'provider-error',
        message: 'unrecognized image format',
      });
    });

    it('rejects a response without data[0]', async () => {
      const { fetch: impl } = recordingFetch(() => jsonResponse({}));
      await expectProviderError(makeProvider(impl).generate({ prompt: 'p', signal: IDLE_SIGNAL }), {
        code: 'provider-error',
        message: 'missing image data',
      });
    });

    it('rejects a data[0] row without b64_json and url', async () => {
      const { fetch: impl } = recordingFetch(() => jsonResponse({ data: [{ revised_prompt: 'x' }] }));
      await expectProviderError(makeProvider(impl).generate({ prompt: 'p', signal: IDLE_SIGNAL }), {
        code: 'provider-error',
        message: 'contains no image data',
      });
    });

    it('rejects an unparseable JSON body', async () => {
      const { fetch: impl } = recordingFetch(() => new Response('<html>oops</html>', { status: 200 }));
      await expectProviderError(makeProvider(impl).generate({ prompt: 'p', signal: IDLE_SIGNAL }), {
        code: 'provider-error',
        message: 'parsing the image service response failed',
      });
    });
  });

  describe('url download guard', () => {
    it.each([
      ['https://127.0.0.1/pic.png'],
      ['https://10.9.8.7/pic.png'],
      ['https://192.168.1.1/pic.png'],
      ['https://169.254.10.10/pic.png'],
      ['https://172.16.0.1/pic.png'],
      ['https://172.31.255.255/pic.png'],
      ['https://0.0.0.0/pic.png'],
      ['https://localhost/pic.png'],
      ['https://cdn.internal.local/pic.png'],
      ['https://[::1]/pic.png'],
    ])('refuses the private or loopback target %s', async url => {
      const { calls, fetch: impl } = recordingFetch(() => jsonResponse({ data: [{ url }] }));
      const provider = makeProvider(impl);
      await expectProviderError(provider.generate({ prompt: 'p', signal: IDLE_SIGNAL }), {
        code: 'provider-error',
      });
      expect(calls).toHaveLength(1);
    });

    it('allows public addresses just outside the 172.16-31 range', async () => {
      const { calls, fetch: impl } = recordingFetch(url => {
        if (url.endsWith('/images/generations')) {
          return jsonResponse({ data: [{ url: 'https://172.32.1.1/pic.png' }] });
        }
        return bytesResponse(PNG_BYTES);
      });
      const result = await makeProvider(impl).generate({ prompt: 'p', signal: IDLE_SIGNAL });
      expect(calls).toHaveLength(2);
      expect(result.mime).toBe('image/png');
    });

    it('refuses non-https download targets', async () => {
      const { calls, fetch: impl } = recordingFetch(() =>
        jsonResponse({ data: [{ url: 'http://cdn.example.com/pic.png' }] })
      );
      const provider = makeProvider(impl);
      await expectProviderError(provider.generate({ prompt: 'p', signal: IDLE_SIGNAL }), {
        code: 'provider-error',
        message: 'must be https',
      });
      expect(calls).toHaveLength(1);
    });

    it('refuses downloads exceeding the 10 MiB cap', async () => {
      const big = Buffer.alloc(10 * 1024 * 1024 + 1);
      const { fetch: impl } = recordingFetch(url => {
        if (url.endsWith('/images/generations')) {
          return jsonResponse({ data: [{ url: 'https://cdn.example.com/big.png' }] });
        }
        return bytesResponse(big);
      });
      await expectProviderError(makeProvider(impl).generate({ prompt: 'p', signal: IDLE_SIGNAL }), {
        code: 'provider-error',
        message: 'MiB limit',
      });
    });

    it('maps download network failures to provider-error', async () => {
      const { fetch: impl } = recordingFetch(url => {
        if (url.endsWith('/images/generations')) {
          return jsonResponse({ data: [{ url: 'https://cdn.example.com/a.png' }] });
        }
        throw new TypeError('fetch failed');
      });
      await expectProviderError(makeProvider(impl).generate({ prompt: 'p', signal: IDLE_SIGNAL }), {
        code: 'provider-error',
        message: 'downloading the image failed: fetch failed',
      });
    });
  });

  describe('error mapping', () => {
    it('maps non-2xx to provider-error with the status and a 200-char body snippet', async () => {
      const { fetch: impl } = recordingFetch(() =>
        new Response(`${'A'.repeat(300)}TAIL-MARKER`, { status: 502 })
      );
      const err = await expectProviderError(
        makeProvider(impl).generate({ prompt: 'p', signal: IDLE_SIGNAL }),
        { code: 'provider-error', status: 502 }
      );
      expect(err.message).toContain('The image service returned 502');
      expect(err.message).toContain('A'.repeat(200));
      expect(err.message).not.toContain('TAIL-MARKER');
      expect(err.message).not.toContain('sk-test-key');
    });

    it('maps network failures to provider-error', async () => {
      const { fetch: impl } = recordingFetch(() => {
        throw new TypeError('fetch failed');
      });
      await expectProviderError(makeProvider(impl).generate({ prompt: 'p', signal: IDLE_SIGNAL }), {
        code: 'provider-error',
        message: 'requesting the image service failed: fetch failed',
      });
    });

    it('maps a request timeout to provider-timeout', async () => {
      const provider = makeProvider(hangingFetch(), { timeoutMs: 20 });
      await expectProviderError(provider.generate({ prompt: 'p', signal: IDLE_SIGNAL }), {
        code: 'provider-timeout',
        message: 'requesting the image service timed out',
      });
    });

    it('rejects with provider-aborted before any request when the signal is already aborted', async () => {
      const { calls, fetch: impl } = recordingFetch(() => jsonResponse({ data: [] }));
      const provider = makeProvider(impl);
      const controller = new AbortController();
      controller.abort();
      await expectProviderError(provider.generate({ prompt: 'p', signal: controller.signal }), {
        code: 'provider-aborted',
      });
      expect(calls).toHaveLength(0);
    });

    it('maps an external cancel to provider-aborted even with a timeout armed', async () => {
      const controller = new AbortController();
      const provider = makeProvider(hangingFetch(), { timeoutMs: 20 });
      const pending = provider.generate({ prompt: 'p', signal: controller.signal });
      controller.abort();
      await expectProviderError(pending, { code: 'provider-aborted' });
    });
  });

  describe('edit', () => {
    it('posts multipart form with model/prompt/size and the source image blob', async () => {
      const { calls, fetch: impl } = recordingFetch(() =>
        jsonResponse({ data: [{ b64_json: PNG_BYTES.toString('base64') }] })
      );
      const provider = makeProvider(impl, { baseUrl: 'https://api.example.com/v1/' });
      const result = await provider.edit({
        prompt: '改成水彩风格',
        size: '1024x1024',
        source: EDIT_SOURCE,
        signal: IDLE_SIGNAL,
      });
      expect(calls[0].url).toBe('https://api.example.com/v1/images/edits');
      expect(calls[0].init.method).toBe('POST');
      const headers = calls[0].init.headers as Record<string, string>;
      expect(headers.Authorization).toBe('Bearer sk-test-key');
      expect(headers['Content-Type']).toBeUndefined();
      const form = calls[0].init.body as FormData;
      expect(form).toBeInstanceOf(FormData);
      expect(form.get('model')).toBe('cogview-4');
      expect(form.get('prompt')).toBe('改成水彩风格');
      expect(form.get('size')).toBe('1024x1024');
      const image = form.get('image') as File;
      expect(image).toBeInstanceOf(Blob);
      expect(image.type).toBe('image/png');
      // 部件名必须带扩展名（无名 Blob 会发 filename="blob"，部分上游拒收）。
      expect(image.name).toBe('image.png');
      expect(Buffer.from(await image.arrayBuffer()).equals(PNG_BYTES)).toBe(true);
      expect(result.bytes.equals(PNG_BYTES)).toBe(true);
    });

    it('omits size from the form when not provided', async () => {
      const { calls, fetch: impl } = recordingFetch(() =>
        jsonResponse({ data: [{ b64_json: PNG_BYTES.toString('base64') }] })
      );
      await makeProvider(impl).edit({
        prompt: 'p',
        source: EDIT_SOURCE,
        signal: IDLE_SIGNAL,
      });
      const form = calls[0].init.body as FormData;
      expect(form.has('size')).toBe(false);
    });

    it.each([404, 405])('maps edit HTTP %i to provider-unsupported', async status => {
      const { fetch: impl } = recordingFetch(() => new Response('nope', { status }));
      const provider = makeProvider(impl);
      const err = await expectProviderError(
        provider.edit({ prompt: 'p', source: EDIT_SOURCE, signal: IDLE_SIGNAL }),
        { code: 'provider-unsupported', status, message: 'The current service does not support image editing' }
      );
      expect(err.status).toBe(status);
    });

    it('maps other edit non-2xx to provider-error with the status', async () => {
      const { fetch: impl } = recordingFetch(() =>
        new Response(JSON.stringify({ error: 'bad request' }), { status: 400 })
      );
      await expectProviderError(
        makeProvider(impl).edit({ prompt: 'p', source: EDIT_SOURCE, signal: IDLE_SIGNAL }),
        { code: 'provider-error', status: 400 }
      );
    });
  });

  describe('usage normalization', () => {
    it.each([
      ['all three keys', { input_tokens: 12, output_tokens: 34, total_cost: 0.05 }, { inputTokens: 12, outputTokens: 34, totalCostUsd: 0.05 }],
      ['a single key', { input_tokens: 7 }, { inputTokens: 7 }],
      ['only cost', { total_cost: 0.2 }, { totalCostUsd: 0.2 }],
      ['unknown keys only', { foo: 1 }, null],
      ['a non-object usage', 'nope', null],
    ])('normalizes usage with %s', async (_name, rawUsage, expected) => {
      const { fetch: impl } = recordingFetch(() =>
        jsonResponse({ data: [{ b64_json: PNG_BYTES.toString('base64') }], usage: rawUsage })
      );
      const result = await makeProvider(impl).generate({ prompt: 'p', signal: IDLE_SIGNAL });
      expect(result.usage).toEqual(expected);
    });

    it('returns null usage when the response has no usage field', async () => {
      const { fetch: impl } = recordingFetch(() =>
        jsonResponse({ data: [{ b64_json: PNG_BYTES.toString('base64') }] })
      );
      const result = await makeProvider(impl).generate({ prompt: 'p', signal: IDLE_SIGNAL });
      expect(result.usage).toBeNull();
    });
  });
});
