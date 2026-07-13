import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

export interface BrowserShellOptions {
  repoRoot?: string;
}

function defaultRepoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
}

export function resolveBrowserShellDist(options: BrowserShellOptions = {}): string {
  const repoRoot = options.repoRoot ?? defaultRepoRoot();
  return path.join(repoRoot, 'apps/desktop/dist');
}

function isBrowserRoute(req: Request): boolean {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  if (req.path.startsWith('/api/')) return false;
  if (req.path === '/api') return false;
  if (req.path.startsWith('/ws')) return false;
  if (req.path.startsWith('/assets/')) return false;
  return true;
}

export function mountBrowserShell(app: Express, options: BrowserShellOptions = {}): void {
  const distDir = resolveBrowserShellDist(options);
  const indexPath = path.join(distDir, 'index.html');

  if (!fs.existsSync(indexPath)) {
    console.warn(
      `[BrowserShell] Browser shell assets not found at ${distDir}; run pnpm build to enable http://127.0.0.1:3100.`
    );
    return;
  }

  app.use(
    express.static(distDir, {
      index: false,
      fallthrough: true,
    })
  );

  app.get('*', (req: Request, res: Response, next: NextFunction) => {
    if (!isBrowserRoute(req)) {
      next();
      return;
    }
    res.type('html').sendFile(indexPath);
  });
}
