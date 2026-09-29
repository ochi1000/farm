import { createServer } from 'node:net';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { config } from '../config.js';
import { Adb } from '../device/adb.js';
import type { BrowserController, PageObservation, XActionResult, XPostSummary, XSessionState } from './types.js';
import { XPage } from './x-page.js';

export class AndroidChromeBrowser implements BrowserController {
  private readonly adb = new Adb();
  private browser?: Browser;
  private context?: BrowserContext;
  private page?: Page;
  private xPage?: XPage;
  private serial?: string;
  private cdpPort?: number;

  async connect(serial: string): Promise<void> {
    this.serial = serial;
    this.cdpPort = await getFreePort();
    await this.adb.checked(['-s', serial, 'forward', `tcp:${this.cdpPort}`, 'localabstract:chrome_devtools_remote']);

    this.browser = await withTimeout(
      chromium.connectOverCDP(`http://127.0.0.1:${this.cdpPort}`),
      config.browserTimeoutMs,
      'Timed out connecting to Android Chrome DevTools socket'
    );
    this.context = this.browser.contexts()[0] ?? (await this.browser.newContext());
    this.context.setDefaultTimeout(config.browserTimeoutMs);
    this.context.setDefaultNavigationTimeout(config.browserTimeoutMs);
    this.page = await this.pickPage(this.context);
    await this.page.bringToFront().catch(() => undefined);
    this.xPage = new XPage(this.page);
  }

  async ensureXOpen(): Promise<void> {
    await this.requireXPage().ensureOpen();
  }

  async openPostUrl(url: string): Promise<void> {
    if (!/^https:\/\/x\.com\/[A-Za-z0-9_]+\/status\/\d+$/.test(url)) throw new Error('Invalid post URL');
    await this.page!.goto(url, { waitUntil: 'domcontentloaded', timeout: config.browserTimeoutMs });
    await this.requireXPage().waitForReady();
  }

  async observe(): Promise<PageObservation> {
    return await this.requireXPage().observe();
  }

  async getSessionState(): Promise<XSessionState> {
    return await this.requireXPage().getSessionState();
  }

  async readVisibleFeed(limit?: number): Promise<XPostSummary[]> {
    return await this.requireXPage().readVisibleFeed(limit);
  }

  async scrollOnce(): Promise<void> {
    await this.requireXPage().scrollOnce();
  }

  async followUser(username: string, commit: boolean): Promise<XActionResult> {
    return await this.requireXPage().followUser(username, commit);
  }

  async likeVisiblePost(index: number, commit: boolean): Promise<XActionResult> {
    return await this.requireXPage().likeVisiblePost(index, commit);
  }

  async commentOnVisiblePost(index: number, text: string, commit: boolean, expectedUrl?: string): Promise<XActionResult> {
    return await this.requireXPage().commentOnVisiblePost(index, text, commit, expectedUrl);
  }

  async createPost(text: string, commit: boolean): Promise<XActionResult> {
    return await this.requireXPage().createPost(text, commit);
  }

  async reload(): Promise<void> {
    await this.requireXPage().reload();
  }

  async closeActiveTab(): Promise<void> {
    const page = this.page;
    const context = this.context;
    const port = this.cdpPort;
    if (!page || !context || !port || page.isClosed()) return;
    try {
      const endpoint = `http://127.0.0.1:${port}`;
      const targets = await readTargets(endpoint);
      const target = targets.find((candidate) => candidate.type === 'page' && candidate.url === page.url())
        ?? targets.find((candidate) => candidate.type === 'page' && isXUrl(candidate.url));
      if (!target) throw new Error('Active Chrome target was not found.');
      const response = await withTimeout(fetch(`${endpoint}/json/close/${encodeURIComponent(target.id)}`), 5_000, 'Timed out closing Chrome target');
      if (!response.ok) throw new Error(`Chrome target close failed with HTTP ${response.status}.`);
      for (let attempt = 0; attempt < 10; attempt += 1) {
        if (!(await readTargets(endpoint)).some((candidate) => candidate.id === target.id)) return;
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      throw new Error('Chrome target remained open after close request.');
    } catch {
      try {
        const session = await context.newCDPSession(page);
        await session.send('Page.close');
      } catch {
        await page.close({ runBeforeUnload: false }).catch(() => undefined);
      }
    }
  }

  async openVisiblePost(index?: number): Promise<void> {
    await this.requireXPage().openVisiblePost(index);
  }

  async goBack(): Promise<void> {
    await this.requireXPage().goBack();
  }

  async disconnect(): Promise<void> {
    await this.browser?.close().catch(() => undefined);
    if (this.serial && this.cdpPort) {
      await this.adb.run(['-s', this.serial, 'forward', '--remove', `tcp:${this.cdpPort}`]).catch(() => undefined);
    }
    this.context = undefined;
    this.browser = undefined;
    this.page = undefined;
    this.xPage = undefined;
    this.serial = undefined;
    this.cdpPort = undefined;
  }

  private requireXPage(): XPage {
    if (!this.xPage) throw new Error('BrowserController is not connected');
    return this.xPage;
  }

  private async pickPage(context: BrowserContext): Promise<Page> {
    const pages = context.pages();
    const scored = await Promise.all(
      pages.map(async (page, index) => ({
        page,
        score: await scorePage(page, index)
      }))
    );
    scored.sort((left, right) => right.score - left.score);
    if (scored[0]?.score && scored[0].score > 0) return scored[0].page;
    return pages[0] ?? (await context.newPage());
  }
}

async function scorePage(page: Page, index: number): Promise<number> {
  const url = page.url();
  const title = await page.title().catch(() => '');
  let score = Math.max(0, 100 - index);
  if (/^https?:\/\/(x\.com|mobile\.x\.com|twitter\.com)\//i.test(url)) score += 1_000;
  if (/home\s*\/\s*x/i.test(title)) score += 500;
  if (title === 'X') score += 100;
  const bodyLength = await page.locator('body').innerText({ timeout: 2_000 }).then((text) => text.trim().length).catch(() => 0);
  if (bodyLength > 0) score += Math.min(bodyLength, 500);
  return score;
}

type CdpTarget = { id: string; type: string; url: string };

async function readTargets(endpoint: string): Promise<CdpTarget[]> {
  const response = await withTimeout(fetch(`${endpoint}/json`), 5_000, 'Timed out reading Chrome targets');
  if (!response.ok) throw new Error(`Chrome target list failed with HTTP ${response.status}.`);
  return await response.json() as CdpTarget[];
}

function isXUrl(value: string): boolean {
  return /^https?:\/\/(x\.com|mobile\.x\.com|twitter\.com)\//i.test(value);
}

async function getFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === 'object') resolve(address.port);
        else reject(new Error('Could not allocate local CDP forwarding port'));
      });
    });
  });
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
