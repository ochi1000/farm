import { AndroidChromeBrowser } from '../browser/android-browser.js';
import type { BrowserController } from '../browser/types.js';
import { config } from '../config.js';
import { Adb } from '../device/adb.js';
import type { DeviceController, ScreenState } from '../device/types.js';
import { XPolicy } from './policy.js';
import { XTaskStore } from './store.js';
import type { XTaskOutput, XTaskRequest } from './types.js';
import { isMutationAction } from './types.js';

export type RunnerDependencies = {
  browser?: BrowserController;
  device?: DeviceController;
  policy?: XPolicy;
  store?: XTaskStore;
  transientRetryDelayMs?: number;
  launchDelayMs?: number;
};

export class XWorkflowRunner {
  private readonly browser: BrowserController;
  private readonly device: DeviceController;
  private readonly policy: XPolicy;
  private readonly store: XTaskStore;
  private readonly transientRetryDelayMs: number;
  private readonly launchDelayMs?: number;

  constructor(dependencies: RunnerDependencies = {}) {
    this.browser = dependencies.browser ?? new AndroidChromeBrowser();
    this.device = dependencies.device ?? new Adb();
    this.policy = dependencies.policy ?? new XPolicy();
    this.store = dependencies.store ?? new XTaskStore();
    this.transientRetryDelayMs = dependencies.transientRetryDelayMs ?? 15_000;
    this.launchDelayMs = dependencies.launchDelayMs;
  }

  async execute(request: XTaskRequest): Promise<XTaskOutput> {
    const stored = this.store.create(request);
    if (stored.existing) {
      if (stored.status === 'succeeded' && stored.result) return stored.result;
      throw new Error(`Idempotency key already belongs to task ${stored.id} with status ${stored.status}.`);
    }
    const taskId = stored.id;
    const startedAt = new Date().toISOString();
    let initialScreen: ScreenState = 'unknown';
    let connected = false;
    let tabClosed = false;

    try {
      this.policy.validate(request);
      if (isMutationAction(request.action) && request.mode === 'commit') {
        this.policy.authorizeMutation(request, this.store.countCommittedToday(request.accountId, request.action));
      }
      this.store.markRunning(taskId);
      initialScreen = await this.device.getScreenState(request.serial);
      await this.device.prepareChromeForBackground(request.serial);
      await this.device.launchChrome(request.serial);
      await wait(this.launchDelayMs ?? (initialScreen === 'off' ? config.chromeScreenOffLaunchDelayMs : 2_000));
      await this.browser.connect(request.serial);
      connected = true;
      await this.browser.ensureXOpen();
      let session = await this.browser.getSessionState();
      if (!session.loggedIn) throw new Error('X is signed out in this Chrome profile. Complete login manually before running tasks.');
      const recoveries: string[] = [];
      if (session.interruption === 'temporary reload error' && (request.action === 'read_feed' || request.action === 'scroll_feed')) {
        await wait(this.transientRetryDelayMs);
        await this.browser.reload();
        session = await this.browser.getSessionState();
        if (!session.interruption) recoveries.push('temporary reload error recovered with one delayed page reload');
      }
      if (session.interruption) throw new Error(`X requires manual review before automation can continue: ${session.interruption}.`);

      const output: XTaskOutput = {
        taskId,
        action: request.action,
        mode: request.mode,
        startedAt,
        finishedAt: '',
        session,
        screenOffMaintained: false,
        ...(recoveries.length ? { recoveries } : {})
      };

      if (request.action === 'read_feed') {
        output.posts = await this.browser.readVisibleFeed(request.payload.limit ?? 5);
        output.observation = await this.browser.observe();
      } else if (request.action === 'scroll_feed') {
        for (let index = 0; index < (request.payload.scrolls ?? 1); index += 1) await this.browser.scrollOnce();
        output.posts = await this.browser.readVisibleFeed(request.payload.limit ?? 5);
        output.observation = await this.browser.observe();
      } else {
        if (request.payload.postUrl && (request.action === 'comment_post' || request.action === 'like_post')) {
          if (!this.browser.openPostUrl) throw new Error('Browser does not support pinned post targets.');
          await this.browser.openPostUrl(request.payload.postUrl);
          const posts = await this.browser.readVisibleFeed(10);
          const target = posts.find(post => post.url === request.payload.postUrl);
          if (!target) throw new Error('Pinned post was not found; refusing to act on a different post.');
          request = { ...request, payload: { ...request.payload, postIndex: target.index } };
        }
        if (request.mode === 'commit') await wait(2_500);
        if (request.action === 'follow_user') output.actionResult = await this.browser.followUser(request.payload.username!, request.mode === 'commit');
        if (request.action === 'like_post') output.actionResult = await this.browser.likeVisiblePost(request.payload.postIndex ?? 0, request.mode === 'commit');
        if (request.action === 'comment_post') output.actionResult = await this.browser.commentOnVisiblePost(request.payload.postIndex ?? 0, request.payload.text!, request.mode === 'commit', request.payload.postUrl);
        if (request.action === 'create_post') output.actionResult = await this.browser.createPost(request.payload.text!, request.mode === 'commit');
        if (request.mode === 'commit' && output.actionResult?.changed) this.store.recordCommit(taskId, request.accountId, request.action);
      }

      if (request.closeTabAfter) {
        await this.browser.closeActiveTab();
        tabClosed = true;
      }
      await this.browser.disconnect();
      connected = false;
      const finalScreen = await this.device.getScreenState(request.serial);
      if (initialScreen === 'off' && finalScreen !== 'off') await this.device.turnScreenOff(request.serial);
      output.screenOffMaintained = initialScreen !== 'off' || await this.device.getScreenState(request.serial) === 'off';
      output.finishedAt = new Date().toISOString();
      this.store.markSucceeded(taskId, output);
      return output;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.store.markFailed(taskId, message);
      throw new Error(`X task ${taskId} failed: ${message}`);
    } finally {
      if (connected) {
        if (request.closeTabAfter && !tabClosed) await this.browser.closeActiveTab().catch(() => undefined);
        await this.browser.disconnect().catch(() => undefined);
      }
      if (initialScreen === 'off') await this.device.turnScreenOff(request.serial).catch(() => undefined);
    }
  }

  close(): void {
    this.store.close();
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
