import { Stagehand } from '@browserbasehq/stagehand';
import { OpenAI } from 'openai';
import { chromium } from 'playwright-core';
import type { Page, Browser } from 'playwright-core';
import type { z } from 'zod';
import { CleanJsonOpenAIClient } from './clean-json-openai-client';

const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:1420';

export interface BrowserAdapterOptions {
  headless?: boolean;
  viewport?: { width: number; height: number };
}

const DEFAULT_OPTIONS: BrowserAdapterOptions = {
  headless: true,
  viewport: { width: 1280, height: 720 },
};

type ModelConfig = { modelName: string; apiKey: string; baseURL: string };

export class BrowserAdapter {
  private stagehand: Stagehand | null = null;
  private playwrightBrowser: Browser | null = null;
  private _page: Page | null = null;

  private currentModelIndex = 0;
  private modelConfigs: ModelConfig[] = [];

  async launch(opts?: BrowserAdapterOptions): Promise<void> {
    const options = { ...DEFAULT_OPTIONS, ...opts };

    this.modelConfigs = this.parseModelConfigs();
    if (this.modelConfigs.length === 0) {
      throw new Error(
        'No model config found. Please set OPENAI_API_KEY/OPENAI_BASE_URL/OPENAI_MODEL_NAME.'
      );
    }

    await this.recreateStagehandAndConnect(options);
  }

  private parseModelConfigs(): ModelConfig[] {
    // When routing through new-api, OPENAI_BASE_URL must look like http://127.0.0.1:3000/v1
    const apiKey = process.env.OPENAI_API_KEY;
    const baseURL = process.env.OPENAI_BASE_URL;

    if (!apiKey || !baseURL) return [];

    const names = (process.env.OPENAI_MODEL_NAME || 'gpt-4o')
      .split(',')
      .map(m => m.trim())
      .filter(Boolean);

    return names.map(modelName => ({ modelName, apiKey, baseURL }));
  }

  private async recreateStagehandAndConnect(options: BrowserAdapterOptions) {
    // Close the previous instance first (best effort).
    await this.safeClose();

    const cfg = this.modelConfigs[this.currentModelIndex];
    console.log(`[BrowserAdapter] Launch with model=${cfg.modelName}, baseURL=${cfg.baseURL}`);

    // ✅ Use CleanJsonOpenAIClient for OpenAI-compatible APIs (e.g. new-api);
    // it strips markdown fences around JSON responses automatically.
    const openai = new OpenAI({
      baseURL: cfg.baseURL,
      apiKey: cfg.apiKey,
    });

    const llmClient = new CleanJsonOpenAIClient({
      modelName: cfg.modelName,
      client: openai,
    });

    this.stagehand = new Stagehand({
      env: 'LOCAL',
      verbose: 2,
      debugDom: true,
      llmClient,
      localBrowserLaunchOptions: {
        headless: options.headless,
        viewport: options.viewport,
      },
    } as any);

    await this.stagehand.init();

    const wsEndpoint = this.stagehand.connectURL();
    this.playwrightBrowser = await chromium.connectOverCDP(wsEndpoint);

    // ✅ Fallback: context/page may be empty.
    let context = this.playwrightBrowser.contexts()[0];
    if (!context) context = await this.playwrightBrowser.newContext();

    let page = context.pages()[0];
    if (!page) page = await context.newPage();

    this._page = page;
  }

  private async withFallback<T>(opName: string, fn: () => Promise<T>): Promise<T> {
    let lastError: any;

    for (let i = 0; i < Math.max(this.modelConfigs.length, 1); i++) {
      try {
        return await fn();
      } catch (err: any) {
        lastError = err;

        const status = err?.status ?? err?.response?.status ?? err?.cause?.status;

        const msg = String(err?.message || '').toLowerCase();

        const is429 =
          status === 429 ||
          msg.includes('429') ||
          msg.includes('rate limit') ||
          msg.includes('quota');

        if (is429 && this.currentModelIndex < this.modelConfigs.length - 1) {
          console.warn(
            `[AI Fallback] ${opName} hit 429 on ${this.modelConfigs[this.currentModelIndex]?.modelName}, switching...`
          );
          this.currentModelIndex++;

          // ✅ Model switch: rebuild Stagehand (otherwise the provider/API shape likely never changes).
          await this.recreateStagehandAndConnect(DEFAULT_OPTIONS);
          continue;
        }

        throw err;
      }
    }

    throw lastError;
  }

  async act(instruction: string) {
    const stagehand = this.stagehand;
    if (!stagehand) throw new Error('Browser not launched');
    return this.withFallback('act', () => stagehand.act(instruction));
  }

  async extract<T extends z.AnyZodObject>(instruction: string, schema: T) {
    const stagehand = this.stagehand;
    if (!stagehand) throw new Error('Browser not launched');
    return this.withFallback('extract', () => stagehand.extract(instruction, { schema } as any));
  }

  get page(): Page {
    if (!this._page) throw new Error('Browser not launched');
    return this._page;
  }

  async goto(url: string) {
    const finalUrl = url.startsWith('/') ? `${BASE_URL}${url}` : url;
    await this.page.goto(finalUrl);
  }

  async close() {
    await this.safeClose();
  }

  private async safeClose() {
    await Promise.allSettled([this.playwrightBrowser?.close(), this.stagehand?.close()]);
    this.playwrightBrowser = null;
    this.stagehand = null;
    this._page = null;
  }

  // Playwright helpers
  locator(selector: string) {
    return this.page.locator(selector);
  }

  async waitForLoadState(state: 'load' | 'domcontentloaded' | 'networkidle') {
    await this.page.waitForLoadState(state);
  }

  async waitForTimeout(ms: number) {
    await this.page.waitForTimeout(ms);
  }

  async evaluate(fn: () => any) {
    return this.page.evaluate(fn);
  }
}

// Factory
export async function createBrowser(opts?: BrowserAdapterOptions): Promise<BrowserAdapter> {
  const browser = new BrowserAdapter();
  await browser.launch(opts);
  return browser;
}
