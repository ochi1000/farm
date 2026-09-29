import type { Page } from 'playwright';
import { config } from '../config.js';
import type { PageObservation, XActionResult, XPostSummary, XSessionState } from './types.js';

const POST_SELECTORS = [
  '[data-testid="tweet"]',
  'article[data-testid="tweet"]',
  'article[role="article"]',
  'article'
];

const INTERRUPTION_PATTERNS = [
  { pattern: /verify (?:that )?you are human/i, label: 'human verification' },
  { pattern: /verify your identity/i, label: 'identity verification' },
  { pattern: /unusual activity/i, label: 'unusual activity warning' },
  { pattern: /account (?:is |has been )?(?:locked|suspended)/i, label: 'account restriction' },
  { pattern: /rate limit exceeded/i, label: 'rate limit' },
  { pattern: /something went wrong\. try reloading/i, label: 'temporary reload error' }
];

export class XPage {
  private accountHandle?: string;
  constructor(private readonly page: Page) {}

  async ensureOpen(): Promise<void> {
    const currentUrl = this.page.url();
    if (!isXUrl(currentUrl)) {
      await this.page.goto(config.xStartUrl, { waitUntil: 'domcontentloaded', timeout: config.browserTimeoutMs });
    }

    await this.page.waitForLoadState('domcontentloaded', { timeout: config.browserTimeoutMs }).catch(() => undefined);
    try {
      await this.waitForReady();
    } catch (firstError) {
      if (!isXUrl(this.page.url())) throw firstError;
      await this.page.reload({ waitUntil: 'domcontentloaded', timeout: config.browserTimeoutMs }).catch(() => undefined);
      try {
        await this.waitForReady();
      } catch {
        const bodyText = await this.page.locator('body').innerText().catch(() => '');
        const title = await this.page.title().catch(() => '');
        throw new Error(`X did not become ready after one page reload (title=${JSON.stringify(title)}, textLength=${bodyText.length}, reloadError=${/something went wrong\. try reloading/i.test(bodyText)}).`);
      }
    }
    const observation = await this.observe();
    const url = observation.url ?? '';
    const text = observation.visibleTextSample ?? '';

    if (!isXUrl(url)) {
      throw new Error(`Chrome page is not on X after navigation: ${url || '(unknown url)'}`);
    }
    if (/log in|sign in/i.test(text) && !/home|following|for you|post/i.test(text)) {
      throw new Error('X appears to require login. Log in manually in Chrome on the phone before running this POC.');
    }
  }

  async waitForReady(): Promise<void> {
    await this.page.waitForFunction(
      () => {
        const bodyText = document.body?.innerText?.trim() ?? '';
        const articleCount = document.querySelectorAll('[data-testid="tweet"], article[role="article"], article').length;
        const authenticated = Boolean(document.querySelector(
          'a[data-testid="AppTabBar_Home_Link"], a[data-testid="AppTabBar_Profile_Link"], a[data-testid="SideNav_NewTweet_Button"]'
        ));
        const terminalState = /sign in|log in|verify (?:that )?you are human|verify your identity|unusual activity|rate limit exceeded|something went wrong\. try reloading/i.test(bodyText);
        return articleCount > 0 || terminalState || bodyText.length > 250 || (authenticated && bodyText.length > 0);
      },
      undefined,
      { timeout: config.xReadyTimeoutMs, polling: 1_000 }
    );
  }

  async observe(): Promise<PageObservation> {
    const visibleTextLimit = config.visibleTextLimit;
    const [url, title, visibleTextSample, visiblePostCount, scrollState] = await Promise.all([
      this.page.url(),
      this.page.title().catch(() => undefined),
      this.page.locator('body').innerText({ timeout: config.browserTimeoutMs }).then((text) => sanitizeVisibleText(text, visibleTextLimit)).catch(() => undefined),
      countVisiblePosts(this.page).catch(() => undefined),
      getScrollState(this.page).catch(() => undefined)
    ]);

    return {
      url,
      title,
      visibleTextSample,
      visiblePostCount,
      scrollTop: scrollState?.scrollTop,
      scrollHeight: scrollState?.scrollHeight,
      timestamp: new Date().toISOString()
    };
  }

  async getSessionState(): Promise<XSessionState> {
    const bodyText = await this.page.locator('body').innerText({ timeout: config.browserTimeoutMs }).catch(() => '');
    const interruption = INTERRUPTION_PATTERNS.find(({ pattern }) => pattern.test(bodyText))?.label;
    const profileLink = this.page.locator('a[data-testid="AppTabBar_Profile_Link"]').first();
    const profileHref = await profileLink.count() ? await profileLink.getAttribute('href').catch(() => null) : null;
    const hasAuthenticatedNavigation = await this.page.locator(
      'a[data-testid="AppTabBar_Home_Link"], a[data-testid="AppTabBar_Profile_Link"], a[data-testid="SideNav_NewTweet_Button"]'
    ).count().then((count) => count > 0).catch(() => false);
    let accountHandle = profileHref?.match(/^\/([^/?#]+)$/)?.[1] || this.accountHandle;
    const mobileMenu = this.page.locator('[data-testid="DashButton_ProfileIcon_Link"]').first();
    if (!accountHandle && !interruption && await mobileMenu.count()) {
      const wasOpen = await mobileMenu.getAttribute('aria-expanded') === 'true';
      try {
        if (!wasOpen) await clickDomControl(mobileMenu);
        const profile = this.page.locator('[role="dialog"] a').filter({ hasText: /^Profile$/ }).first();
        const href = await profile.getAttribute('href', { timeout: 5000 });
        accountHandle = href?.match(/^\/([A-Za-z0-9_]{1,15})$/)?.[1];
      } finally {
        if (!wasOpen && await mobileMenu.getAttribute('aria-expanded') === 'true') await clickDomControl(mobileMenu);
      }
    }
    if (accountHandle) this.accountHandle = accountHandle;
    const popups = await this.page.locator('[role="dialog"]').evaluateAll((dialogs) => dialogs
      .filter((dialog) => {
        const style = getComputedStyle(dialog);
        const bounds = dialog.getBoundingClientRect();
        return style.visibility !== 'hidden' && style.display !== 'none' && bounds.width > 0 && bounds.height > 0;
      })
      .map((dialog) => dialog.textContent?.replace(/\s+/g, ' ').trim().slice(0, 160) || 'Unnamed dialog')
      .slice(0, 5)).catch(() => []);
    return {
      loggedIn: hasAuthenticatedNavigation,
      ...(accountHandle ? { accountHandle } : {}),
      ...(interruption ? { interruption } : {}),
      ...(popups.length ? { popups } : {})
    };
  }

  async readVisibleFeed(limit = 5): Promise<XPostSummary[]> {
    const posts = await this.postLocator();
    const count = Math.min(await posts.count(), Math.max(1, Math.min(limit, 20)));
    const summaries: XPostSummary[] = [];
    for (let index = 0; index < count; index += 1) {
      const post = posts.nth(index);
      if (!(await post.isVisible().catch(() => false))) continue;
      const summary = await post.evaluate((element, postIndex) => {
        const nameText = element.querySelector('[data-testid="User-Name"]')?.textContent?.replace(/\s+/g, ' ').trim();
        const handle = nameText?.match(/@[A-Za-z0-9_]{1,15}/)?.[0];
        const statusLink = Array.from(element.querySelectorAll<HTMLAnchorElement>('a[href*="/status/"]'))
          .map((link) => link.href)
          .find(Boolean);
        return {
          index: postIndex,
          author: nameText,
          handle,
          text: element.querySelector('[data-testid="tweetText"]')?.textContent?.replace(/\s+/g, ' ').trim(),
          url: statusLink,
          createdAt: element.querySelector('time')?.getAttribute('datetime') ?? undefined,
          liked: Boolean(element.querySelector('[data-testid="unlike"]'))
        };
      }, index);
      summaries.push(summary);
    }
    return summaries;
  }

  async scrollOnce(): Promise<void> {
    await this.page.evaluate(() => {
      const candidates = [document.scrollingElement, document.documentElement, document.body, ...Array.from(document.querySelectorAll('*'))]
        .filter((element): element is Element => Boolean(element))
        .map((element) => ({
          element,
          room: element.scrollHeight - element.clientHeight,
          top: element.scrollTop
        }))
        .filter((candidate) => candidate.room > 100)
        .sort((left, right) => right.room - left.room);
      const target = candidates[0]?.element ?? document.scrollingElement ?? document.documentElement;
      target.scrollBy({ top: Math.max(window.innerHeight * 0.8, 700), left: 0, behavior: 'instant' });
    });
    await this.page.waitForTimeout(1_000);
  }

  async followUser(username: string, commit: boolean): Promise<XActionResult> {
    const normalized = normalizeUsername(username);
    await this.page.goto(`https://x.com/${normalized}`, { waitUntil: 'domcontentloaded', timeout: config.browserTimeoutMs });
    await this.waitForReady();
    await this.assertNoInterruption();
    const following = this.page.locator('button[data-testid$="-unfollow"]').first();
    if (await following.isVisible().catch(() => false)) {
      return { action: 'follow_user', dryRun: !commit, changed: false, state: 'already_following', target: normalized };
    }
    const follow = this.page.locator('button[data-testid$="-follow"]').first();
    if (!(await follow.isVisible().catch(() => false))) throw new Error(`A Follow control was not available for @${normalized}.`);
    if (!commit) return { action: 'follow_user', dryRun: true, changed: false, state: 'would_follow', target: normalized };
    await clickDomControl(follow);
    await following.waitFor({ state: 'visible', timeout: config.browserTimeoutMs });
    return { action: 'follow_user', dryRun: false, changed: true, state: 'following', target: normalized };
  }

  async likeVisiblePost(index: number, commit: boolean): Promise<XActionResult> {
    const post = (await this.postLocator()).nth(index);
    await post.waitFor({ state: 'visible', timeout: config.browserTimeoutMs });
    await this.assertNoInterruption();
    const unlike = post.locator('[data-testid="unlike"]').first();
    if (await unlike.isVisible().catch(() => false)) {
      return { action: 'like_post', dryRun: !commit, changed: false, state: 'already_liked', target: await postUrl(post) };
    }
    const like = post.locator('[data-testid="like"]').first();
    if (!(await like.isVisible().catch(() => false))) throw new Error(`Like control was not available on visible post ${index}.`);
    const target = await postUrl(post);
    if (!commit) return { action: 'like_post', dryRun: true, changed: false, state: 'would_like', target };
    await clickDomControl(like);
    await unlike.waitFor({ state: 'visible', timeout: config.browserTimeoutMs });
    return { action: 'like_post', dryRun: false, changed: true, state: 'liked', target };
  }

  async commentOnVisiblePost(index: number, text: string, commit: boolean, expectedUrl?: string): Promise<XActionResult> {
    const posts = await this.postLocator();
    const post = expectedUrl
      ? posts.filter({ has: this.page.locator(`a[href="${new URL(expectedUrl).pathname}"], a[href="${expectedUrl}"]`) }).first()
      : posts.nth(index);
    await post.waitFor({ state: 'visible', timeout: config.browserTimeoutMs });
    await this.assertNoInterruption();
    const reply = post.locator('[data-testid="reply"]').first();
    if (!(await reply.isVisible().catch(() => false))) throw new Error(`Reply control was not available on visible post ${index}.`);
    const target = await postUrl(post);
    if (expectedUrl && target !== expectedUrl) throw new Error('Pinned comment target changed');
    if (!commit) return { action: 'comment_post', dryRun: true, changed: false, state: 'would_comment', target };
    const account = (await this.getSessionState()).accountHandle;
    if (!account) throw new Error('Cannot verify the signed-in account before commenting');
    await clickDomControl(reply);
    const editor = this.page.locator('[data-testid="tweetTextarea_0"]').last();
    await editor.waitFor({ state: 'visible', timeout: config.browserTimeoutMs });
    await editor.fill(text);
    const submit = this.page.locator('[data-testid="tweetButton"]').last();
    await clickDomControl(submit);
    await editor.waitFor({ state: 'hidden', timeout: config.browserTimeoutMs });
    await this.assertNoInterruption();
    const publishedUrl = await this.verifyPublishedText(account, text);
    return { action: 'comment_post', dryRun: false, changed: true, state: 'comment_verified', target: publishedUrl };
  }

  async createPost(text: string, commit: boolean): Promise<XActionResult> {
    await this.page.goto('https://x.com/compose/post', { waitUntil: 'domcontentloaded', timeout: config.browserTimeoutMs });
    await this.waitForReady();
    await this.assertNoInterruption();
    const editor = this.page.locator('[data-testid="tweetTextarea_0"]').first();
    await editor.waitFor({ state: 'visible', timeout: config.browserTimeoutMs });
    if (!commit) return { action: 'create_post', dryRun: true, changed: false, state: 'would_create_post' };
    const account = (await this.getSessionState()).accountHandle;
    if (!account) throw new Error('Cannot verify the signed-in account before posting');
    await editor.fill(text);
    const submit = this.page.locator('[data-testid="tweetButton"], [data-testid="tweetButtonInline"]').last();
    await clickDomControl(submit);
    await this.page.waitForURL((url) => !url.pathname.startsWith('/compose/'), { timeout: config.browserTimeoutMs });
    const publishedUrl = await this.verifyPublishedText(account, text);
    return { action: 'create_post', dryRun: false, changed: true, state: 'post_verified', target: publishedUrl };
  }

  private async verifyPublishedText(account: string, text: string): Promise<string> {
    const normalized = normalizeUsername(account);
    await this.page.goto(`https://x.com/${normalized}/with_replies`, { waitUntil: 'domcontentloaded', timeout: config.browserTimeoutMs });
    await this.waitForReady();
    const deadline = Date.now() + config.browserTimeoutMs;
    while (Date.now() < deadline) {
      await this.assertNoInterruption();
      const posts = await this.readVisibleFeed(20);
      const found = posts.find(post => post.handle?.replace(/^@/, '').toLowerCase() === normalized.toLowerCase() && post.text === text.replace(/\s+/g, ' ').trim() && post.url);
      if (found?.url) return found.url;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw new Error('Submission may have occurred, but the authored post could not be verified. Do not retry automatically.');
  }

  async reload(): Promise<void> {
    await this.page.reload({ waitUntil: 'domcontentloaded', timeout: config.browserTimeoutMs });
    await this.waitForReady();
    await this.page.waitForTimeout(3_000);
  }

  async openVisiblePost(index = 0): Promise<void> {
    for (const selector of POST_SELECTORS) {
      const posts = this.page.locator(selector);
      const count = await posts.count().catch(() => 0);
      if (count > index) {
        await posts.nth(index).click({ timeout: config.browserTimeoutMs });
        await this.page.waitForLoadState('domcontentloaded', { timeout: config.browserTimeoutMs }).catch(() => undefined);
        await this.page.waitForTimeout(1_000);
        return;
      }
    }
    throw new Error('No visible X post/article element found to open');
  }

  async goBack(): Promise<void> {
    await this.page.goBack({ waitUntil: 'domcontentloaded', timeout: config.browserTimeoutMs }).catch(async () => {
      await this.page.keyboard.press('Alt+Left');
    });
    await this.page.waitForTimeout(1_000);
  }

  private async assertNoInterruption(): Promise<void> {
    const state = await this.getSessionState();
    if (state.interruption) throw new Error('X displayed a security, account, or rate-limit interruption. Manual review is required.');
  }

  private async postLocator() {
    for (const selector of POST_SELECTORS) {
      const posts = this.page.locator(selector);
      if (await posts.count().catch(() => 0)) return posts;
    }
    return this.page.locator('[data-testid="tweet"]');
  }
}

function isXUrl(value: string): boolean {
  return /^https?:\/\/(x\.com|mobile\.x\.com|twitter\.com)\//i.test(value);
}

// Background Chrome may suspend animation frames used by Playwright's stability check.
// Check the actual DOM control and activate it once; never retry a submission click.
async function clickDomControl(locator: import('playwright').Locator): Promise<void> {
  await locator.evaluate(element => {
    const control = element as HTMLElement;
    const style = getComputedStyle(control);
    if (!control.isConnected || !control.getClientRects().length || style.display === 'none' || style.visibility === 'hidden' || control.hasAttribute('disabled') || control.getAttribute('aria-disabled') === 'true') throw new Error('Control is unavailable');
    control.click();
  }, undefined, { timeout: config.browserTimeoutMs });
}

function sanitizeVisibleText(text: string, limit: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > limit ? `${normalized.slice(0, limit)}...` : normalized;
}

async function countVisiblePosts(page: Page): Promise<number> {
  for (const selector of POST_SELECTORS) {
    const count = await page.locator(selector).count();
    if (count > 0) return count;
  }
  return 0;
}

async function getScrollState(page: Page): Promise<{ scrollTop: number; scrollHeight: number }> {
  return await page.evaluate(() => {
    const candidates = [document.scrollingElement, document.documentElement, document.body, ...Array.from(document.querySelectorAll('*'))]
      .filter((element): element is Element => Boolean(element))
      .map((element) => ({
        element,
        room: element.scrollHeight - element.clientHeight,
        scrollTop: element.scrollTop,
        scrollHeight: element.scrollHeight
      }))
      .filter((candidate) => candidate.room > 100)
      .sort((left, right) => right.room - left.room);
    const target = candidates[0] ?? {
      scrollTop: window.scrollY,
      scrollHeight: document.documentElement.scrollHeight
    };
    return {
      scrollTop: Math.round(target.scrollTop),
      scrollHeight: Math.round(target.scrollHeight)
    };
  });
}

function normalizeUsername(value: string): string {
  const normalized = value.trim().replace(/^@/, '');
  if (!/^[A-Za-z0-9_]{1,15}$/.test(normalized)) throw new Error('X username must contain 1-15 letters, numbers, or underscores.');
  return normalized;
}

async function postUrl(post: import('playwright').Locator): Promise<string | undefined> {
  return await post.locator('a[href*="/status/"]').first().getAttribute('href').then((href) => {
    if (!href) return undefined;
    return new URL(href, 'https://x.com').toString();
  }).catch(() => undefined);
}
