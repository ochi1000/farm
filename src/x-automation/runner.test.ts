import assert from 'node:assert/strict';
import test from 'node:test';
import type { BrowserController, PageObservation, XActionResult, XPostSummary, XSessionState } from '../browser/types.js';
import type { DeviceController, DeviceInfo, ScreenState } from '../device/types.js';
import { XWorkflowRunner } from './runner.js';
import { XTaskStore } from './store.js';
import type { XTaskRequest } from './types.js';

class MockBrowser implements BrowserController {
  async openPostUrl(): Promise<void> {}
  connected = 0;
  closedTabs = 0;
  reloads = 0;
  session: XSessionState = { loggedIn: true, accountHandle: 'lab_account' };
  sessionAfterReload?: XSessionState;
  async connect(): Promise<void> { this.connected += 1; }
  async ensureXOpen(): Promise<void> {}
  async observe(): Promise<PageObservation> { return { timestamp: new Date().toISOString(), url: 'https://x.com/home' }; }
  async getSessionState(): Promise<XSessionState> { return this.session; }
  async readVisibleFeed(): Promise<XPostSummary[]> { return [{ index: 0, text: 'fixture post', liked: false }]; }
  async scrollOnce(): Promise<void> {}
  async followUser(username: string, commit: boolean): Promise<XActionResult> {
    return { action: 'follow_user', dryRun: !commit, changed: commit, state: commit ? 'following' : 'would_follow', target: username };
  }
  async likeVisiblePost(): Promise<XActionResult> { return { action: 'like_post', dryRun: true, changed: false, state: 'would_like' }; }
  async commentOnVisiblePost(): Promise<XActionResult> { return { action: 'comment_post', dryRun: true, changed: false, state: 'would_comment' }; }
  async createPost(): Promise<XActionResult> { return { action: 'create_post', dryRun: true, changed: false, state: 'would_create_post' }; }
  async reload(): Promise<void> {
    this.reloads += 1;
    if (this.sessionAfterReload) this.session = this.sessionAfterReload;
  }
  async closeActiveTab(): Promise<void> { this.closedTabs += 1; }
  async openVisiblePost(): Promise<void> {}
  async goBack(): Promise<void> {}
  async disconnect(): Promise<void> { this.connected -= 1; }
}

test('missing pinned target aborts without commenting', async () => {
  const browser = new MockBrowser();
  let commented = false;
  browser.commentOnVisiblePost = async () => { commented = true; throw new Error('unexpected'); };
  const runner = new XWorkflowRunner({ browser, device: new MockDevice(), store: new XTaskStore(':memory:'), launchDelayMs: 0 });
  try {
    await assert.rejects(runner.execute(request({ action: 'comment_post', payload: { text: 'Test', postUrl: 'https://x.com/test/status/123' }, closeTabAfter: true })), /Pinned post was not found/);
    assert.equal(commented, false);
    assert.equal(browser.closedTabs, 1);
  } finally { runner.close(); }
});

class MockDevice implements DeviceController {
  screen: ScreenState = 'off';
  launches = 0;
  async getConnectedDevices(): Promise<DeviceInfo[]> { return []; }
  async getScreenState(): Promise<ScreenState> { return this.screen; }
  async prepareChromeForBackground(): Promise<void> {}
  async wakeScreen(): Promise<void> { this.screen = 'on'; }
  async turnScreenOff(): Promise<void> { this.screen = 'off'; }
  async launchChrome(): Promise<void> { this.launches += 1; }
  async backgroundChrome(): Promise<void> {}
  async getForegroundPackage(): Promise<string | null> { return 'com.android.chrome'; }
}

function request(overrides: Partial<XTaskRequest> = {}): XTaskRequest {
  return {
    accountId: 'lab-account',
    deviceId: 'device-1',
    serial: 'adb-serial',
    action: 'read_feed',
    mode: 'dry-run',
    payload: { limit: 5 },
    ...overrides
  };
}

test('read workflow preserves screen-off state and closes the requested tab', async () => {
  const browser = new MockBrowser();
  const device = new MockDevice();
  const store = new XTaskStore(':memory:');
  const runner = new XWorkflowRunner({ browser, device, store, launchDelayMs: 0 });
  try {
    const result = await runner.execute(request({ closeTabAfter: true }));
    assert.equal(result.posts?.[0]?.text, 'fixture post');
    assert.equal(result.screenOffMaintained, true);
    assert.equal(browser.closedTabs, 1);
    assert.equal(browser.connected, 0);
    assert.equal(device.launches, 1);
  } finally {
    runner.close();
  }
});

test('idempotency returns the completed result without a second device operation', async () => {
  const browser = new MockBrowser();
  const device = new MockDevice();
  const runner = new XWorkflowRunner({ browser, device, store: new XTaskStore(':memory:'), transientRetryDelayMs: 0, launchDelayMs: 0 });
  try {
    const task = request({ idempotencyKey: 'same-read-task' });
    const first = await runner.execute(task);
    const second = await runner.execute(task);
    assert.equal(second.taskId, first.taskId);
    assert.equal(device.launches, 1);
  } finally {
    runner.close();
  }
});

test('interrupted workflow closes the requested tab and restores screen-off state', async () => {
  const browser = new MockBrowser();
  browser.session = { loggedIn: true, interruption: 'temporary reload error' };
  const device = new MockDevice();
  const runner = new XWorkflowRunner({ browser, device, store: new XTaskStore(':memory:'), transientRetryDelayMs: 0, launchDelayMs: 0 });
  try {
    await assert.rejects(
      runner.execute(request({ closeTabAfter: true })),
      /temporary reload error/
    );
    assert.equal(browser.closedTabs, 1);
    assert.equal(browser.connected, 0);
    assert.equal(device.screen, 'off');
    assert.equal(browser.reloads, 1);
  } finally {
    runner.close();
  }
});

test('read workflow performs one delayed recovery for a temporary reload error', async () => {
  const browser = new MockBrowser();
  browser.session = { loggedIn: true, interruption: 'temporary reload error' };
  browser.sessionAfterReload = { loggedIn: true, accountHandle: 'lab_account' };
  const runner = new XWorkflowRunner({
    browser,
    device: new MockDevice(),
    store: new XTaskStore(':memory:'),
    transientRetryDelayMs: 0,
    launchDelayMs: 0
  });
  try {
    const output = await runner.execute(request({ closeTabAfter: true }));
    assert.deepEqual(output.recoveries, ['temporary reload error recovered with one delayed page reload']);
    assert.equal(browser.reloads, 1);
    assert.equal(browser.closedTabs, 1);
  } finally {
    runner.close();
  }
});
