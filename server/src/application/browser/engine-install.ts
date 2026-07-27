import type { BrowserEngineStatusMessage } from '@zclaudia/shared';

export interface EngineInstallDeps {
  /** Runs the download, reporting (downloadedBytes, totalBytes). Returns executable path. */
  install(onProgress: (downloaded: number, total: number) => void): Promise<string>;
}

let inFlight = false;

export async function installEngine(
  deps: EngineInstallDeps,
  notify: (msg: BrowserEngineStatusMessage) => void
): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  notify({ type: 'browser_engine_status', status: 'downloading', progress: 0 });
  try {
    const executablePath = await deps.install((downloaded, total) => {
      notify({
        type: 'browser_engine_status',
        status: 'downloading',
        progress: total > 0 ? downloaded / total : 0,
      });
    });
    notify({ type: 'browser_engine_status', status: 'ready', executablePath });
  } catch (err) {
    notify({
      type: 'browser_engine_status',
      status: 'error',
      message: err instanceof Error ? err.message : String(err),
    });
  } finally {
    inFlight = false;
  }
}

/** Production deps: download stable Chrome into the zclaudia browsers cache. */
export function defaultEngineInstallDeps(cacheDir: string): EngineInstallDeps {
  return {
    install: async (onProgress) => {
      const { install, resolveBuildId, detectBrowserPlatform, Browser, computeExecutablePath } =
        await import('@puppeteer/browsers');
      const platform = detectBrowserPlatform();
      if (!platform) throw new Error('unsupported platform for Chrome download');
      const buildId = await resolveBuildId(Browser.CHROME, platform, 'stable');
      await install({
        browser: Browser.CHROME,
        buildId,
        cacheDir,
        downloadProgressCallback: onProgress,
      });
      return computeExecutablePath({ browser: Browser.CHROME, buildId, cacheDir });
    },
  };
}
