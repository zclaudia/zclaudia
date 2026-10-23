import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DesignHttpError,
  exportDesignZip,
  getDesignDeps,
  isDesignHttpError,
  putDesignDocument,
} from '../api';

vi.mock('../../../services/api/base', () => ({
  getBaseUrlForBackend: vi.fn((backendId: string) => `http://design.test/${backendId}`),
  getAuthHeadersForBackend: vi.fn(() => ({ Authorization: 'Bearer t' })),
  fetchApiForBackend: vi.fn(),
}));

vi.mock('../../../services/api/unwrap', () => ({
  apiCallForBackend: vi.fn(),
}));

import { apiCallForBackend } from '../../../services/api/unwrap';

const fetchMock = vi.fn();

describe('P2 design api wrappers', () => {
  beforeEach(() => {
    vi.mocked(apiCallForBackend).mockReset();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('getDesignDeps queries the deps endpoint with session and path', async () => {
    vi.mocked(apiCallForBackend).mockResolvedValue({
      entry: { path: 'design/index.html', size: 10, mtimeMs: 1 },
      files: [],
      skipped: [],
    });
    const result = await getDesignDeps('b1', 's1', 'design/index.html');
    expect(apiCallForBackend).toHaveBeenCalledWith(
      'b1',
      '/api/design/deps?sessionId=s1&path=design%2Findex.html'
    );
    expect(result.entry.path).toBe('design/index.html');
  });

  it('putDesignDocument forwards allowCreate in the request body', async () => {
    vi.mocked(apiCallForBackend).mockResolvedValue({
      path: 'design/index.html',
      source: '<p>x</p>',
      revision: 'r1',
    });
    await putDesignDocument('b1', {
      sessionId: 's1',
      path: 'design/index.html',
      source: '<p>x</p>',
      expectedRevision: '',
      allowCreate: true,
    });
    const [, , init] = vi.mocked(apiCallForBackend).mock.calls[0]!;
    expect(JSON.parse(String(init?.body))).toEqual({
      sessionId: 's1',
      path: 'design/index.html',
      source: '<p>x</p>',
      expectedRevision: '',
      allowCreate: true,
    });
  });

  it('exportDesignZip parses the filename from a zip response', async () => {
    fetchMock.mockResolvedValue(
      new Response('zip-bytes', {
        status: 200,
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': 'attachment; filename="index-20261023-120000.zip"',
        },
      })
    );
    const result = await exportDesignZip('b1', {
      sessionId: 's1',
      path: 'design/index.html',
      mode: 'disk',
      expectedRevision: 'rev-1',
    });
    expect(result.filename).toBe('index-20261023-120000.zip');
    // jsdom 与 undici 的 Blob 分属两个 realm，instanceof 不可靠；断言内容。
    expect(result.blob.size).toBe(9);
    expect(result.blob.type).toBe('application/zip');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://design.test/b1/api/design/export');
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>)?.Authorization).toBe('Bearer t');
    expect(JSON.parse(String(init?.body))).toEqual({
      sessionId: 's1',
      path: 'design/index.html',
      mode: 'disk',
      expectedRevision: 'rev-1',
    });
  });

  it('exportDesignZip lifts EXPORT_INCOMPLETE errors with the missing file list', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          success: false,
          error: { code: 'EXPORT_INCOMPLETE', message: 'missing', files: ['a.png', 'b.css'] },
        }),
        { status: 409, headers: { 'Content-Type': 'application/json' } }
      )
    );
    const error = await exportDesignZip('b1', {
      sessionId: 's1',
      path: 'design/index.html',
      mode: 'disk',
    }).catch(e => e);
    expect(isDesignHttpError(error)).toBe(true);
    expect(error).toBeInstanceOf(DesignHttpError);
    expect((error as DesignHttpError).code).toBe('EXPORT_INCOMPLETE');
    expect((error as DesignHttpError).files).toEqual(['a.png', 'b.css']);
    expect((error as DesignHttpError).message).toBe('missing');
  });

  it('exportDesignZip falls back to a status message for non-JSON error bodies', async () => {
    fetchMock.mockResolvedValue(new Response('boom', { status: 500 }));
    const error = await exportDesignZip('b1', {
      sessionId: 's1',
      path: 'design/index.html',
      mode: 'draft',
      draftSource: '<p>x</p>',
      confirmIncomplete: true,
    }).catch(e => e);
    expect(isDesignHttpError(error)).toBe(true);
    expect((error as DesignHttpError).code).toBeUndefined();
    expect((error as DesignHttpError).message).toContain('500');
    // draft 请求体只在提供时携带对应字段。
    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse(String(init?.body))).toEqual({
      sessionId: 's1',
      path: 'design/index.html',
      mode: 'draft',
      draftSource: '<p>x</p>',
      confirmIncomplete: true,
    });
  });
});
