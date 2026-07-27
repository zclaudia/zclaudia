import { existsSync } from 'node:fs';

export interface ChromeDiscoveryDeps {
  env: Record<string, string | undefined>;
  platform: NodeJS.Platform;
  exists(path: string): boolean;
  /** Executable paths found in the ~/.zclaudia/browsers puppeteer cache. */
  listInstalled(): Promise<string[]>;
}

const WELL_KNOWN: Partial<Record<NodeJS.Platform, string[]>> = {
  linux: [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
  ],
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ],
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ],
};

export async function resolveChromePath(deps: ChromeDiscoveryDeps): Promise<string | null> {
  const fromEnv = deps.env.ZCLAUDIA_CHROME_PATH;
  if (fromEnv) {
    return deps.exists(fromEnv) ? fromEnv : null;
  }
  for (const candidate of WELL_KNOWN[deps.platform] ?? []) {
    if (deps.exists(candidate)) return candidate;
  }
  const installed = await deps.listInstalled();
  return installed[0] ?? null;
}

/** Production deps: real fs + @puppeteer/browsers cache under the zclaudia data dir. */
export function defaultChromeDiscoveryDeps(cacheDir: string): ChromeDiscoveryDeps {
  return {
    env: process.env,
    platform: process.platform,
    exists: (p) => {
      try {
        return existsSync(p);
      } catch {
        return false;
      }
    },
    listInstalled: async () => {
      const { getInstalledBrowsers } = await import('@puppeteer/browsers');
      try {
        const browsers = await getInstalledBrowsers({ cacheDir });
        return browsers.map((b) => b.executablePath);
      } catch {
        return [];
      }
    },
  };
}
