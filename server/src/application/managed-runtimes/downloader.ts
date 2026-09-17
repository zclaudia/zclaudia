import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import type { ManagedRuntimeSettings } from './types.js';

const DOWNLOAD_TIMEOUT_MS = 2 * 60 * 1000;

export interface DownloadResult {
  sha256: string;
  size: number;
  finalUrl: string;
}

export function validateDownloadUrl(urlValue: string, settings: ManagedRuntimeSettings): URL {
  let url: URL;
  try {
    url = new URL(urlValue);
  } catch {
    throw new Error(`Invalid managed runtime download URL: ${urlValue}`);
  }
  if (url.username || url.password) throw new Error('Download URLs may not contain credentials');
  const enterpriseAllowed = settings.enterpriseMirrorOrigins.includes(url.origin);
  if (url.protocol !== 'https:' && !enterpriseAllowed) {
    throw new Error(
      `Managed runtime downloads require HTTPS; ${url.origin} is not a configured enterprise mirror`
    );
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`Unsupported managed runtime URL protocol: ${url.protocol}`);
  }
  return url;
}

export async function downloadToFile(options: {
  fetchImpl: typeof globalThis.fetch;
  getSettings: () => Promise<ManagedRuntimeSettings>;
  urlValue: string;
  destination: string;
  expectedSha256: string;
  expectedSize: number | undefined;
  maxSize: number;
}): Promise<DownloadResult> {
  const { fetchImpl, getSettings, urlValue, destination, expectedSha256, expectedSize, maxSize } =
    options;
  const settings = await getSettings();
  let url = validateDownloadUrl(urlValue, settings);
  let response: Response | undefined;
  for (let redirect = 0; redirect <= 5; redirect += 1) {
    response = await fetchImpl(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get('location');
    if (!location) throw new Error('Managed runtime redirect is missing Location');
    url = validateDownloadUrl(new URL(location, url).toString(), settings);
  }
  if (!response?.ok) {
    throw new Error(`Managed runtime download failed with HTTP ${response?.status ?? 'unknown'}`);
  }
  const contentLength = Number(response.headers.get('content-length') ?? 0);
  if (Number.isFinite(contentLength) && contentLength > maxSize) {
    throw new Error(`Managed runtime download exceeds ${maxSize} bytes`);
  }
  if (expectedSize !== undefined && contentLength > 0 && contentLength !== expectedSize) {
    throw new Error(
      `Managed runtime download size mismatch: expected ${expectedSize}, got ${contentLength}`
    );
  }
  if (!response.body) throw new Error('Managed runtime download returned an empty body');
  const file = await open(destination, 'wx', 0o600);
  const hash = createHash('sha256');
  let size = 0;
  try {
    for await (const chunkValue of response.body as unknown as AsyncIterable<Uint8Array>) {
      const chunk = Buffer.from(chunkValue);
      size += chunk.length;
      if (size > maxSize) throw new Error(`Managed runtime download exceeds ${maxSize} bytes`);
      hash.update(chunk);
      await file.write(chunk);
    }
  } finally {
    await file.close();
  }
  if (expectedSize !== undefined && size !== expectedSize) {
    throw new Error(
      `Managed runtime download size mismatch: expected ${expectedSize}, got ${size}`
    );
  }
  const sha256 = hash.digest('hex');
  if (sha256 !== expectedSha256.toLowerCase()) {
    throw new Error(
      `Managed runtime SHA-256 mismatch: expected ${expectedSha256.toLowerCase()}, got ${sha256}`
    );
  }
  return { sha256, size, finalUrl: url.toString() };
}
