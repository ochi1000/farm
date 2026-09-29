// Read-only bounded reconciliation. Run with node --import tsx. Never submits or replays.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
import { XPage } from '../src/browser/x-page.ts';

const plan = JSON.parse(fs.readFileSync('.automation/brain-live-plan.json', 'utf8'));
const record = JSON.parse(fs.readFileSync('.desktop-data/devices.json', 'utf8')).find(item => item.deviceId === plan.deviceId);
const run = promisify(execFile);
const adb = async args => (await run('adb', args, { encoding: 'utf8', timeout: 10000, windowsHide: true })).stdout.trim();
const hash = value => createHash('sha256').update(value).digest('hex');
const normalize = value => value.replace(/\s+/g, ' ').trim();
const report = { startedAt: new Date().toISOString(), deviceId: plan.deviceId, publication: 'unconfirmed', liveSubmissions: 0, textSha256: hash(plan.post.text), uniquePostsObserved: 0 };
let port, browser, page;
try {
  report.stage = 'device_identity';
  if (!record || await adb(['-s', record.serial, 'shell', 'getprop', 'ro.serialno']) !== record.serial) throw new Error('identity_mismatch');
  report.stage = 'chrome_start';
  await adb(['-s', record.serial, 'shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', 'https://x.com/home', 'com.android.chrome']);
  port = await adb(['-s', record.serial, 'forward', 'tcp:0', 'localabstract:chrome_devtools_remote']);
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 20000 });
  // Own a new read-only tab; preserve the user's existing tabs.
  page = await browser.contexts()[0].newPage();
  await page.bringToFront();
  page.setDefaultTimeout(10000);
  page.setDefaultNavigationTimeout(20000);
  await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded' });
  const x = new XPage(page);
  await x.waitForReady();
  report.stage = 'account_identity';
  const session = await x.getSessionState();
  const account = plan.accountHandle?.replace(/^@/, '').toLowerCase();
  report.accountMatched = Boolean(account && session.accountHandle?.replace(/^@/, '').toLowerCase() === account);
  if (!session.loggedIn || !report.accountMatched || session.interruption || session.popups?.length) throw new Error('account_not_ready');
  report.stage = 'authored_timeline';
  const seen = new Set(), matches = new Set();
  report.timelines = [];
  for (const suffix of ['/with_replies', '']) {
  await page.goto(`https://x.com/${account}${suffix}`, { waitUntil: 'domcontentloaded' });
  await x.waitForReady();
  // Navigation chrome can be ready while the authored timeline is still loading.
  await page.waitForFunction(() => Boolean(document.querySelector('article, [data-testid="emptyState"]')), undefined, { timeout: 20000, polling: 1000 });
  const timeline = await page.evaluate(() => ({
    articleCount: document.querySelectorAll('article').length,
    emptyStatePresent: Boolean(document.querySelector('[data-testid="emptyState"]')),
    emptyStateSaysNoPosts: /hasn.t posted|haven.t posted|no posts|no replies|nothing to see|when .*post|when .*repl/i.test(document.querySelector('[data-testid="emptyState"]')?.textContent || ''),
    textLength: document.body?.innerText?.length ?? 0
  }));
  report.timelines.push({ kind: suffix ? 'replies' : 'posts', ...timeline });
  for (let index = 0; index < 6; index++) {
    const state = await x.getSessionState();
    if (state.interruption || state.popups?.length) throw new Error('timeline_interrupted');
    const posts = await x.readVisibleFeed(20);
    for (const post of posts) {
      if (post.url) seen.add(post.url);
      const permalink = post.url?.match(/^https:\/\/x\.com\/([A-Za-z0-9_]+)\/status\/(\d+)(?:[/?#]|$)/);
      if (post.text && normalize(post.text) === normalize(plan.post.text) && post.handle?.replace(/^@/, '').toLowerCase() === account && permalink?.[1].toLowerCase() === account) {
        matches.add(`https://x.com/${account}/status/${permalink[2]}`);
      }
    }
    report.uniquePostsObserved = seen.size;
    if (index < 5) await x.scrollOnce();
  }
  }
  report.exactAuthoredMatches = matches.size;
  if (matches.size) {
    report.publication = matches.size === 1 ? 'confirmed_published' : 'multiple_matches';
    report.permalinkSha256 = [...matches].map(hash);
    fs.writeFileSync('.automation/prior-post-reconciliation.json', JSON.stringify({ planId: plan.id, at: new Date().toISOString(), textSha256: hash(plan.post.text), permalinks: [...matches] }, null, 2));
  }
  report.searchExhaustive = false;
  report.stage = 'complete';
} catch {
  report.blocker = `${report.stage}_failed`;
} finally {
  await page?.close({ runBeforeUnload: false }).catch(() => {});
  await browser?.close().catch(() => {});
  if (port) await adb(['-s', record.serial, 'forward', '--remove', `tcp:${port}`]).catch(() => {});
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync('results/prior-post-reconciliation.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}
