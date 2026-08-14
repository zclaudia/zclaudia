/**
 * Agent browser tool.
 *
 * Multi-action tool that lets the agent drive the session's shared browser
 * (the same Chromium page the user watches live in their Browser panel via
 * BrowserManager) — navigate, read the page, screenshot, click, type, scroll.
 * Falls back to a plain HTTP fetch + text-extraction action when no browser
 * engine is available, or when the agent just wants to read a URL without
 * driving a page (the pre-Phase-3 behavior, kept verbatim as `legacyFetch`).
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { toolRegistry } from '../../plugins/tool-registry.js';
import { isBlockedHostname } from './network-guard.js';
import { readResponseBodyWithBudget } from './stream-read.js';
import { normalizeUrl } from '../handlers/browser.js';
import type { BrowserManager } from '../../browser/browser-manager.js';

const TEXT_BUDGET = 20_000;

// Monotonic tie-breaker for screenshot filenames: sessionId + Date.now() can
// collide when the agent takes two screenshots inside the same millisecond,
// which would silently overwrite the first file.
let screenshotCounter = 0;

/** Simple HTML to text conversion (strip tags, decode entities) */
function htmlToText(html: string): string {
  return (
    html
      // Remove script and style blocks
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      // Replace block elements with newlines
      .replace(/<\/?(p|div|br|h[1-6]|li|tr)[^>]*>/gi, '\n')
      // Remove remaining tags
      .replace(/<[^>]+>/g, '')
      // Decode common HTML entities
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ')
      // Collapse whitespace
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

/** Phase-3-pre-existing plain-HTTP-fetch action, unchanged. */
async function legacyFetch(args: Record<string, unknown>): Promise<string> {
  const urlStr = args.url as string;
  const format = (args.format as string) || 'text';

  try {
    const parsed = new URL(urlStr);
    if (await isBlockedHostname(parsed.hostname)) {
      return JSON.stringify({ error: 'Requests to private/internal addresses are blocked' });
    }

    const response = await fetch(urlStr, {
      headers: {
        'User-Agent': 'ZClaudia-Agent/1.0',
        Accept: 'text/html, application/json, text/plain, */*',
      },
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      return JSON.stringify({
        error: `HTTP ${response.status}: ${response.statusText}`,
        url: urlStr,
      });
    }

    // P1-16: stream the body with a hard byte budget instead of buffering
    // the entire response via response.text() before slicing (shared with
    // agent_http_request). 256KB is generous enough that htmlToText still
    // yields a useful amount of text for script-heavy pages.
    const MAX_BODY_BYTES = 256 * 1024;
    const { text: body, truncated } = await readResponseBodyWithBudget(response, MAX_BODY_BYTES);

    switch (format) {
      case 'html':
        return JSON.stringify({
          url: urlStr,
          content: body.slice(0, 16000),
          ...(truncated && { truncated: true }),
        });
      case 'raw':
        return body.slice(0, 16000);
      case 'text':
      default:
        return JSON.stringify({
          url: urlStr,
          content: htmlToText(body).slice(0, 8000),
          ...(truncated && { truncated: true }),
        });
    }
  } catch (err: unknown) {
    return JSON.stringify({
      error: err instanceof Error ? err.message : String(err),
      url: urlStr,
    });
  }
}

export interface BrowserToolDeps {
  getBrowserManager: () => BrowserManager | undefined;
  broadcastAgentActivity: (sessionId: string, active: boolean) => void;
  getScreenshotDir: () => string;
}

export function registerBrowserTool(deps: BrowserToolDeps): void {
  toolRegistry.register({
    id: 'agent_browser',
    source: 'interaction',
    scope: ['agent-assistant'],
    definition: {
      type: 'function',
      function: {
        name: 'agent_browser',
        description:
          "Drive the session's shared browser (the user watches it live in their Browser panel). " +
          'Actions: navigate (load a URL), read_page (visible text of the current page), screenshot ' +
          '(saves a JPEG, returns its file path), click (CSS selector or x/y page coordinates), type ' +
          '(into the focused element, optional submit=Enter), scroll (up/down), read_console (recent ' +
          'console output and uncaught page errors — check this after loading or interacting with a ' +
          'page you are debugging), read_network (recent network requests with status/timing — check ' +
          'this to diagnose failing API calls or missing assets). Legacy action fetch ' +
          '(default when action is omitted) does a plain HTTP fetch with text extraction and works ' +
          'without a browser engine — useful for reading documentation, API responses, or web pages ' +
          'without executing JavaScript.',
        parameters: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['navigate', 'read_page', 'screenshot', 'click', 'type', 'scroll', 'read_console', 'read_network', 'fetch'],
              description: 'Defaults to fetch when omitted.',
            },
            url: { type: 'string', description: 'navigate/fetch target' },
            selector: { type: 'string', description: 'click: CSS selector' },
            x: { type: 'number', description: 'click: page x (CSS px), used with y when no selector' },
            y: { type: 'number' },
            text: { type: 'string', description: 'type: text to enter' },
            submit: { type: 'boolean', description: 'type: press Enter after (default false)' },
            direction: { type: 'string', enum: ['up', 'down'], description: 'scroll (default down)' },
            amount: { type: 'number', description: 'scroll: pixels (default 600)' },
            level: {
              type: 'string',
              enum: ['error', 'warn'],
              description: 'read_console: error = errors only, warn = warnings + errors (default all levels)',
            },
            limit: { type: 'number', description: 'read_console/read_network: max entries, most recent (default 50)' },
            filter: {
              type: 'string',
              enum: ['error'],
              description: 'read_network: only failed requests (network errors or status >= 400)',
            },
            format: {
              type: 'string',
              enum: ['text', 'html', 'raw'],
              description:
                'fetch only. text (default, strips HTML), html (raw HTML), raw (for JSON/API responses)',
            },
          },
          required: [],
        },
      },
    },
    handler: async (args, context) => {
      const action = (args.action as string | undefined) ?? 'fetch';
      if (action === 'fetch') return legacyFetch(args);

      const sessionId = context?.sessionId as string | undefined;
      if (!sessionId) return JSON.stringify({ error: 'no active session for browser control' });
      const manager = deps.getBrowserManager();
      if (!manager) return JSON.stringify({ error: 'browser manager unavailable' });

      deps.broadcastAgentActivity(sessionId, true);
      try {
        return await runBrowserAction(manager, sessionId, action, args, deps);
      } catch (err) {
        return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
      } finally {
        deps.broadcastAgentActivity(sessionId, false);
      }
    },
  });
}

async function runBrowserAction(
  manager: BrowserManager,
  sessionId: string,
  action: string,
  args: Record<string, unknown>,
  deps: BrowserToolDeps
): Promise<string> {
  const ensured = await manager.ensureSession(sessionId);
  if (!ensured.ok) {
    return JSON.stringify({
      error:
        'browser engine unavailable on the server (no Chromium found). Use action "fetch" for plain HTTP, or ask the user to install Chromium.',
    });
  }

  switch (action) {
    case 'navigate': {
      const url = args.url as string | undefined;
      if (!url) return JSON.stringify({ error: 'navigate requires url' });
      const normalized = normalizeUrl(url);
      // Deliberate asymmetry vs. `fetch` below: navigate drives the VISIBLE
      // shared browser panel — activity indicator, auto-open, and live frames
      // all give the user real-time oversight of where the agent goes, which
      // is exactly the dev-preview use case (pointing the agent at a
      // localhost/private dev server). So private/localhost addresses are
      // allowed by design here; only the URL *scheme* is restricted, to keep
      // the agent from driving the browser to `file://`, `chrome://`, etc.
      // `fetch` is headless and invisible to the user, so it keeps the full
      // `isBlockedHostname` SSRF guard instead.
      const scheme = new URL(normalized).protocol;
      if (scheme !== 'http:' && scheme !== 'https:') {
        return JSON.stringify({ error: 'agent navigation is limited to http(s) URLs' });
      }
      await manager.navigate(sessionId, normalized);
      return stateWithText(manager, sessionId);
    }
    case 'read_page': {
      const page = await manager.extractText(sessionId);
      if (!page) return JSON.stringify({ error: 'no page' });
      return JSON.stringify({
        url: page.url,
        title: page.title,
        text: truncate(page.text),
      });
    }
    case 'screenshot': {
      const shot = await manager.screenshot(sessionId);
      if (!shot) return JSON.stringify({ error: 'no page' });
      const dir = deps.getScreenshotDir();
      mkdirSync(dir, { recursive: true });
      // sessionId can arrive from the local HTTP route unvalidated; strip
      // anything but safe filename characters so it can't escape `dir` via
      // path traversal (e.g. "../../evil"), and add a monotonic counter so
      // two screenshots in the same millisecond don't overwrite each other.
      const safe = sessionId.replace(/[^A-Za-z0-9_-]/g, '_');
      const file = join(dir, `${safe}-${Date.now()}-${screenshotCounter++}.jpg`);
      writeFileSync(file, Buffer.from(shot.data, 'base64'));
      return JSON.stringify({
        file,
        width: shot.width,
        height: shot.height,
        note: 'JPEG saved on the server; read the file to view it.',
      });
    }
    case 'click': {
      const selector = args.selector as string | undefined;
      if (selector) {
        const hit = await manager.clickSelector(sessionId, selector);
        if (hit === null) return JSON.stringify({ error: 'no page' });
        if (!hit) return JSON.stringify({ error: `no element matches ${selector}` });
      } else if (typeof args.x === 'number' && typeof args.y === 'number') {
        const base = { kind: 'mouse' as const, x: args.x, y: args.y, button: 'left' as const, clickCount: 1 };
        await manager.input(sessionId, { ...base, type: 'down' });
        await manager.input(sessionId, { ...base, type: 'up' });
      } else {
        return JSON.stringify({ error: 'click requires selector or x+y' });
      }
      return stateWithText(manager, sessionId);
    }
    case 'type': {
      const text = (args.text as string | undefined) ?? '';
      const submit = args.submit === true;
      // Empty text with submit:true is valid — "just press Enter" on the
      // focused element. Only reject when there's neither text to type nor
      // an Enter to send.
      if (!text && !submit) return JSON.stringify({ error: 'type requires text or submit' });
      await manager.typeText(sessionId, text, submit);
      return JSON.stringify({ ok: true });
    }
    case 'read_console': {
      const entries = manager.getConsole(sessionId);
      if (!entries) return JSON.stringify({ error: 'no page' });
      const level = args.level as string | undefined;
      const wanted =
        level === 'error'
          ? entries.filter((e) => e.level === 'error')
          : level === 'warn'
            ? entries.filter((e) => e.level === 'error' || e.level === 'warn')
            : entries;
      const limit = typeof args.limit === 'number' && args.limit > 0 ? Math.floor(args.limit) : 50;
      return JSON.stringify({
        total: wanted.length,
        entries: wanted.slice(-limit),
      });
    }
    case 'read_network': {
      const entries = manager.getNetwork(sessionId);
      if (!entries) return JSON.stringify({ error: 'no page' });
      const wanted =
        args.filter === 'error'
          ? entries.filter((e) => e.errorText !== undefined || (e.status !== undefined && e.status >= 400))
          : entries;
      const limit = typeof args.limit === 'number' && args.limit > 0 ? Math.floor(args.limit) : 50;
      return JSON.stringify({
        total: wanted.length,
        entries: wanted.slice(-limit),
      });
    }
    case 'scroll': {
      const amount = typeof args.amount === 'number' ? args.amount : 600;
      const deltaY = (args.direction === 'up' ? -1 : 1) * amount;
      await manager.input(sessionId, { kind: 'wheel', x: 10, y: 10, deltaX: 0, deltaY });
      return JSON.stringify({ ok: true });
    }
    default:
      return JSON.stringify({ error: `unknown action ${action}` });
  }
}

async function stateWithText(manager: BrowserManager, sessionId: string): Promise<string> {
  // A click (or navigate) can trigger a page navigation while extractText's
  // evaluate() is still running, tearing down the execution context mid-call
  // ("Execution context was destroyed"). That's a benign race, not a real
  // failure — the outer handler's catch would otherwise turn a successful
  // click into a reported error. Fall back to a getState()-only summary.
  const page = await manager.extractText(sessionId).catch(() => null);
  const state = manager.getState(sessionId);
  return JSON.stringify({
    url: state?.url ?? page?.url,
    title: state?.title ?? page?.title,
    text: truncate(page?.text ?? ''),
  });
}

function truncate(text: string): string {
  return text.length > TEXT_BUDGET ? `${text.slice(0, TEXT_BUDGET)}…[truncated]` : text;
}
