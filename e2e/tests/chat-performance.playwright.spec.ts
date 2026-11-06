import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { expect, test, type Page } from '@playwright/test';
import type {} from '../fixtures/chat-performance';

let javascript: string;
let stylesheet: string;

test.beforeAll(async () => {
  const assets = fileURLToPath(new URL('../../apps/desktop/dist/assets/', import.meta.url));
  const cssFiles = existsSync(assets)
    ? readdirSync(assets).filter(file => file.endsWith('.css'))
    : [];
  if (!cssFiles.length) {
    throw new Error(
      'Desktop CSS is missing. Run `pnpm --filter @zclaudia/desktop build` before the chat performance tests.'
    );
  }
  stylesheet = cssFiles.map(file => readFileSync(`${assets}/${file}`, 'utf8')).join('\n');

  const bundle = await build({
    entryPoints: [fileURLToPath(new URL('../fixtures/chat-performance.tsx', import.meta.url))],
    nodePaths: [fileURLToPath(new URL('../../apps/desktop/node_modules/', import.meta.url))],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    define: {
      'process.env.NODE_ENV': '"production"',
      __APP_VERSION__: '"chat-performance"',
      'import.meta.env': '{}',
      'import.meta.hot': 'undefined',
    },
    plugins: [
      {
        name: 'chat-performance-boundaries',
        setup(builder) {
          builder.onResolve({ filter: /services\/api$/ }, args =>
            args.importer.endsWith('/useMessagePagination.ts')
              ? { path: 'api', namespace: 'chat-performance' }
              : undefined
          );
          builder.onResolve({ filter: /\/useRunInTerminal$/ }, () => ({
            path: 'terminal',
            namespace: 'chat-performance',
          }));
          builder.onResolve(
            { filter: /\/(LoadingIndicator|CompactionNoticeBanner|TodoFloatingPanel)$/ },
            args => ({ path: args.path.split('/').at(-1)!, namespace: 'chat-performance' })
          );
          builder.onLoad({ filter: /.*/, namespace: 'chat-performance' }, args => ({
            loader: 'js',
            contents:
              args.path === 'api'
                ? `export async function getSessionMessages(_sessionId, options) {
                    const fixture = window.chatPerformance;
                    fixture.fetchCalls.push({ limit: options.limit, before: options.before });
                    const older = options.before !== undefined;
                    if (older && fixture.holdOlder) {
                      await new Promise(resolve => { fixture.releaseOlder = resolve; });
                    }
                    return {
                      messages: older ? fixture.olderMessages : fixture.initialMessages,
                      pagination: { total: 70, hasMore: !older, oldestTimestamp: older ? -19 : 1 }
                    };
                  }`
                : args.path === 'terminal'
                  ? 'export const useRunInTerminal = () => undefined;'
                  : `export const ${args.path} = () => null;`,
          }));
        },
      },
    ],
  });
  javascript = bundle.outputFiles[0].text;
});

function metrics(page: Page) {
  return page.locator('.overflow-y-auto').evaluate(element => ({
    top: element.scrollTop,
    gap: element.scrollHeight - element.clientHeight - element.scrollTop,
    rows: document.querySelectorAll('[data-message-id]').length,
  }));
}

async function expectBottom(page: Page) {
  await expect.poll(async () => Math.abs((await metrics(page)).gap)).toBeLessThanOrEqual(2);
}

async function settleLayout(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>(resolve =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        )
      )
  );
}

async function scrollUp(page: Page) {
  // Wait for the real scroll handler and its next frame before mutating data.
  await page.locator('.overflow-y-auto').evaluate(
    element =>
      new Promise<void>(resolve => {
        element.addEventListener('scroll', () => requestAnimationFrame(() => resolve()), {
          once: true,
        });
        element.scrollTop -= 500;
      })
  );
  await expect.poll(async () => (await metrics(page)).gap).toBeGreaterThan(200);
}

let pageErrors: string[] = [];

test.beforeEach(async ({ page }) => {
  pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.route('http://chat-performance.test/**', route =>
    route.fulfill({ contentType: 'text/html', body: '<html></html>' })
  );
  await page.goto('http://chat-performance.test');
  await page.setContent(`<!doctype html><html><head>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    </head><body><div id="root" style="height:100dvh;display:flex;flex-direction:column"></div></body></html>`);
  await page.addStyleTag({ content: `${stylesheet}\nbody{margin:0}` });
  await page.addScriptTag({ content: javascript });
  await expect.poll(() => page.evaluate(() => window.chatPerformance.ready)).toBe(true);
  await expect(page.locator('[data-message-id="m49"]')).toBeAttached();
  await expect.poll(() => page.evaluate(() => window.chatPerformance.messageCount)).toBe(50);
  await expectBottom(page);
  expect((await metrics(page)).rows).toBeLessThan(30);
  expect((await metrics(page)).rows).toBeGreaterThan(0);
});

test.afterEach(() => {
  expect(pageErrors).toEqual([]);
});

test('virtualized chat follows streaming, preserves reading position and anchors prepended history', async ({
  page,
}) => {
  await page.evaluate(() => {
    window.chatPerformance.stableParagraph = document.querySelector('[data-message-id="m49"] p');
  });
  expect(await page.evaluate(() => Boolean(window.chatPerformance.stableParagraph))).toBe(true);

  for (let index = 0; index < 10; index++) {
    await page.evaluate(() => window.chatPerformance.append());
    // Exercise interleaved browser scroll events, ResizeObserver and streamed frames.
    await page.waitForTimeout(40);
  }
  await expect(page.locator('[data-message-id="m49"]')).toContainText('Stream chunk 10');
  await expectBottom(page);
  expect(
    await page.evaluate(
      () =>
        window.chatPerformance.stableParagraph ===
        document.querySelector('[data-message-id="m49"] p')
    )
  ).toBe(true);

  const fetchesBefore = await page.evaluate(() => window.chatPerformance.fetchCalls.length);
  // Pass the bottom-refresh cooldown so a false user-scroll signal would fetch.
  await page.waitForTimeout(2700);
  const cooledChunk = await page.evaluate(() => window.chatPerformance.append());
  await expect(page.locator('[data-message-id="m49"]')).toContainText(
    `Stream chunk ${cooledChunk}`
  );
  await expectBottom(page);
  expect(await page.evaluate(() => window.chatPerformance.fetchCalls.length)).toBe(fetchesBefore);

  await scrollUp(page);
  const readingTop = (await metrics(page)).top;
  const readingChunk = await page.evaluate(() => window.chatPerformance.append());
  await expect(page.locator('[data-message-id="m49"]')).toContainText(
    `Stream chunk ${readingChunk}`
  );
  await settleLayout(page);
  await expect
    .poll(async () => Math.abs((await metrics(page)).top - readingTop))
    .toBeLessThanOrEqual(2);
  expect((await metrics(page)).gap).toBeGreaterThan(200);

  await page.evaluate(() => window.chatPerformance.jump());
  await expectBottom(page);
  await scrollUp(page);
  const anchor = await page.locator('.overflow-y-auto').evaluate(element => {
    const viewport = element.getBoundingClientRect();
    const row = [...document.querySelectorAll('[data-message-id]')].find(
      candidate =>
        candidate.getBoundingClientRect().bottom > viewport.top &&
        candidate.getBoundingClientRect().top < viewport.bottom
    );
    if (!row) throw new Error('Expected a visible message before prepending history');
    return { id: row.getAttribute('data-message-id')!, top: row.getBoundingClientRect().top };
  });
  await page.evaluate(() => window.chatPerformance.older());
  await expect.poll(() => page.evaluate(() => window.chatPerformance.messageCount)).toBe(70);
  await settleLayout(page);
  await expect
    .poll(() =>
      page.evaluate(() => window.chatPerformance.fetchCalls.some(call => call.before !== undefined))
    )
    .toBe(true);
  const anchorRow = page.locator(`[data-message-id="${anchor.id}"]`);
  await expect(anchorRow).toBeAttached();
  await expect
    .poll(async () => Math.abs(((await anchorRow.boundingBox())?.y ?? Infinity) - anchor.top))
    .toBeLessThanOrEqual(2);
});

test('loading older history near the top preserves the measured visible anchor', async ({
  page,
}) => {
  await page.evaluate(() => window.chatPerformance.jump());
  await expectBottom(page);
  // The real hook suppresses loading history for 1200ms after jumping.
  await page.waitForTimeout(1300);
  await page.locator('.overflow-y-auto').evaluate(element => {
    window.chatPerformance.holdOlder = true;
    element.scrollTop = 75;
  });
  const anchorRow = page.locator('[data-message-id="m0"]');
  await expect(anchorRow).toBeAttached();
  await expect
    .poll(() => page.evaluate(() => Boolean(window.chatPerformance.releaseOlder)))
    .toBe(true);
  // Let virtual rows replace their estimates with measured heights while the
  // API request is pending, then capture the actual visible message position.
  await page.evaluate(
    () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  );
  const anchor = await anchorRow.boundingBox();
  expect(anchor).not.toBeNull();
  await page.evaluate(() => window.chatPerformance.releaseOlder?.());
  await expect.poll(() => page.evaluate(() => window.chatPerformance.messageCount)).toBe(70);
  await settleLayout(page);
  await expect(anchorRow).toBeAttached();
  await expect
    .poll(async () => Math.abs(((await anchorRow.boundingBox())?.y ?? Infinity) - anchor!.y))
    .toBeLessThanOrEqual(2);
});
