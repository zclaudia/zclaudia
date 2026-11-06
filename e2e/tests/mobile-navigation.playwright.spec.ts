import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { expect, test, type CDPSession, type Page } from '@playwright/test';
import type {} from '../fixtures/mobile-navigation';

let javascript: string;
test.beforeAll(async () => {
  const bundle = await build({
    entryPoints: [fileURLToPath(new URL('../fixtures/mobile-navigation.tsx', import.meta.url))],
    nodePaths: [fileURLToPath(new URL('../../apps/desktop/node_modules/', import.meta.url))],
    bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  javascript = bundle.outputFiles[0].text;
});

const css = `
  *{box-sizing:border-box}body{margin:0}button{min-height:44px}
  #navigation-shell{position:relative;width:100vw;height:100dvh;overflow:hidden;touch-action:auto}
  #content{position:absolute;inset:0;overflow-y:auto;touch-action:auto;background:white}
  #background-button{display:block;margin:70px 0 0 230px;width:150px}
  #horizontal-scroll{margin-top:85px;width:100%;height:120px;overflow-x:auto;overflow-y:hidden;touch-action:auto;background:#d9e8ff}
  #wide-content{width:1400px;height:120px;padding:40px;font-family:monospace}
  #long-content{padding:20px}
  #backdrop{position:absolute;inset:0;background:rgba(0,0,0,.5);z-index:10;touch-action:pan-y pinch-zoom}
  #drawer{position:absolute;left:0;top:0;height:100%;z-index:20;background:#eee;touch-action:pan-y pinch-zoom;overflow-y:auto}
`;

test.beforeEach(async ({ page }) => {
  await page.route('http://mobile-navigation.test/**', route => route.fulfill({ contentType: 'text/html', body: '<html></html>' }));
  await page.goto('http://mobile-navigation.test');
  await page.setContent('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>');
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: javascript });
  await expect.poll(() => page.evaluate(() => window.mobileNavigation?.ready)).toBe(true);
});

function snapshot(page: Page) { return page.evaluate(() => window.mobileNavigation.snapshot()); }
async function idle(page: Page, open: boolean) {
  await expect.poll(async () => { const state = await snapshot(page); return state.phase === 'idle' && state.targetOpen === open; }).toBe(true);
}
async function input(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  return {
    start: (x: number, y: number) => point(cdp, 'touchStart', x, y),
    move: (x: number, y: number) => point(cdp, 'touchMove', x, y),
    end: () => cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }),
    detach: () => cdp.detach(),
  };
}
async function point(cdp: CDPSession, type: 'touchStart' | 'touchMove', x: number, y: number) {
  await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: [{ id: 1, x, y, radiusX: 1, radiusY: 1, force: 1 }] });
}

test('trusted slow drag/reversal locks one owner and held releases retain the original target', async ({ page }) => {
  const finger = await input(page);
  await finger.start(160, 440);
  await finger.move(200, 440);
  await expect.poll(async () => (await snapshot(page)).position).toBeCloseTo(32, 0);
  await finger.move(70, 440);
  await expect.poll(async () => (await snapshot(page)).position).toBe(0);
  await finger.end();
  await idle(page, false);
  expect((await snapshot(page)).claudiaStarts).toBe(0);
  await finger.start(160, 440);
  await finger.move(198, 440);
  await page.waitForTimeout(100);
  await finger.end();
  await idle(page, false);
  expect((await snapshot(page)).trustedTouchStarts).toBe(2);
  await finger.detach();
});

test('native vertical and nested horizontal scrolling keep ownership to the end', async ({ page }) => {
  const finger = await input(page);
  await finger.start(180, 650);
  for (let y = 620; y >= 350; y -= 30) await finger.move(180, y);
  await finger.end();
  await expect.poll(() => page.locator('#content').evaluate(element => element.scrollTop)).toBeGreaterThan(100);
  expect((await snapshot(page)).position).toBe(0);
  await page.locator('#content').evaluate(element => { element.scrollTop = 0; });
  // Stop vertical inertia before beginning the independent horizontal touch.
  await page.waitForTimeout(150);
  await page.locator('#horizontal-scroll').evaluate(element => { element.scrollLeft = 60; });
  await finger.start(100, 250);
  for (let x = 120; x <= 360; x += 20) await finger.move(x, 250);
  await finger.end();
  await expect.poll(() => page.locator('#horizontal-scroll').evaluate(element => element.scrollLeft)).toBeLessThanOrEqual(1);
  const state = await snapshot(page);
  expect(state.position).toBe(0);
  expect(state.claudiaStarts).toBe(0);
  // At the boundary a new independent touch may open navigation.
  await finger.start(100, 250); await finger.move(160, 250);
  await expect.poll(async () => (await snapshot(page)).position).toBeGreaterThan(40);
  await finger.end(); await finger.detach();
});

test('wide drawer keeps its width, can be retouched mid-close, and pending taps resume', async ({ page }) => {
  await page.evaluate(() => window.mobileNavigation.open()); await idle(page, true);
  await page.evaluate(() => window.mobileNavigation.toggleWidth());
  const wide = await snapshot(page);
  expect(wide.width).toBe(390);
  const finger = await input(page);
  await finger.start(250, 450); await finger.move(180, 450);
  expect((await snapshot(page)).width).toBe(wide.width);
  expect((await snapshot(page)).position).toBeCloseTo(wide.width - 62, 0);
  await finger.move(10, 450); await page.waitForTimeout(100); await finger.end();
  // Capture an actual in-flight frame, then retouch its visible portion.
  await expect.poll(async () => { const s = await snapshot(page); return s.position > 10 && s.position < 170 && s.phase === 'settling'; }).toBe(true);
  await finger.start(5, 450);
  const paused = await snapshot(page);
  expect(paused.phase).toBe('pending');
  await page.waitForTimeout(35);
  expect(Math.abs((await snapshot(page)).position - paused.position)).toBeLessThanOrEqual(2);
  await finger.move(35, 450);
  expect(Math.abs((await snapshot(page)).position - (paused.position + 22))).toBeLessThanOrEqual(2);
  expect((await snapshot(page)).width).toBe(wide.width);
  await finger.move(280, 450);
  await finger.end(); await idle(page, true);
  await page.evaluate(() => window.mobileNavigation.close());
  await expect.poll(async () => { const s = await snapshot(page); return s.position > 30 && s.position < 300; }).toBe(true);
  await finger.start(5, 450); await finger.end();
  await idle(page, false);
  expect((await snapshot(page)).position).toBe(0);
  await finger.detach();
});

test('close keeps backdrop hit testing until settled and a new tap then reaches content', async ({ page }) => {
  await page.evaluate(() => window.mobileNavigation.open()); await idle(page, true);
  await page.evaluate(() => window.mobileNavigation.close());
  await expect.poll(async () => { const s = await snapshot(page); return s.position > 20 && s.position < 280; }).toBe(true);
  expect((await snapshot(page)).modalActive).toBe(true);
  expect(await page.evaluate(() => document.elementFromPoint(350, 90)?.id)).toBe('backdrop');
  await page.touchscreen.tap(350, 90);
  expect((await snapshot(page)).backgroundClicks).toBe(0);
  await idle(page, false);
  await page.touchscreen.tap(350, 90);
  expect((await snapshot(page)).backgroundClicks).toBe(1);
});
