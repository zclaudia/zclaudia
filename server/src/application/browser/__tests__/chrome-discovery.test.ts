import { describe, it, expect } from 'vitest';
import { resolveChromePath, type ChromeDiscoveryDeps } from '../chrome-discovery.js';

function deps(overrides: Partial<ChromeDiscoveryDeps> = {}): ChromeDiscoveryDeps {
  return {
    env: {},
    platform: 'linux',
    exists: () => false,
    listInstalled: async () => [],
    ...overrides,
  };
}

describe('resolveChromePath', () => {
  it('prefers ZCLAUDIA_CHROME_PATH when the file exists', async () => {
    const d = deps({
      env: { ZCLAUDIA_CHROME_PATH: '/opt/my-chrome' },
      exists: (p) => p === '/opt/my-chrome',
    });
    expect(await resolveChromePath(d)).toBe('/opt/my-chrome');
  });

  it('ignores ZCLAUDIA_CHROME_PATH when the file does not exist', async () => {
    const d = deps({ env: { ZCLAUDIA_CHROME_PATH: '/gone' } });
    expect(await resolveChromePath(d)).toBeNull();
  });

  it('finds the first existing well-known path on linux', async () => {
    const d = deps({
      exists: (p) => p === '/usr/bin/chromium',
    });
    expect(await resolveChromePath(d)).toBe('/usr/bin/chromium');
  });

  it('finds well-known paths on darwin', async () => {
    const mac = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    const d = deps({ platform: 'darwin', exists: (p) => p === mac });
    expect(await resolveChromePath(d)).toBe(mac);
  });

  it('falls back to the puppeteer cache listing', async () => {
    const d = deps({ listInstalled: async () => ['/home/u/.zclaudia/browsers/chrome/linux-123/chrome'] });
    expect(await resolveChromePath(d)).toBe('/home/u/.zclaudia/browsers/chrome/linux-123/chrome');
  });

  it('returns null when nothing is found', async () => {
    expect(await resolveChromePath(deps())).toBeNull();
  });
});
