import { AndroidChromeBrowser } from '../browser/android-browser.js';
import { Adb } from '../device/adb.js';
import { makeRunId, printSummary, writeRunResult } from '../logging/logger.js';
import { runBaseline } from '../tests/baseline.js';
import { runBackgroundOnly as runBackgroundOnlyTest } from '../tests/background-only.js';
import { runChromeBackground } from '../tests/chrome-background.js';
import { runScreenOffBackgroundOnly } from '../tests/screen-off-background-only.js';
import { runScreenOff } from '../tests/screen-off.js';
import { runScreenOffBackground } from '../tests/screen-off-background.js';
import type { TestContext } from '../tests/helpers.js';
import type { RunResult, TestResult } from './result.js';

export async function runBaselineOnly(serial: string, pauseMs: number): Promise<{ run: RunResult; path: string }> {
  return await runSelected(serial, pauseMs, false);
}

export async function runFullMatrix(serial: string, pauseMs: number): Promise<{ run: RunResult; path: string }> {
  return await runSelected(serial, pauseMs, true);
}

export async function runBackgroundOnly(serial: string, pauseMs: number): Promise<{ run: RunResult; path: string }> {
  const runId = makeRunId();
  const startedAt = new Date().toISOString();
  const device = new Adb();
  const browser = new AndroidChromeBrowser();
  const ctx: TestContext = { serial, device, browser, pauseMs };
  const results: TestResult[] = [];

  try {
    results.push(await runBackgroundOnlyTest(ctx));
  } finally {
    await settleCleanup(browser.disconnect());
    await settleCleanup(device.wakeScreen(serial));
  }

  const run: RunResult = {
    runId,
    serial,
    startedAt,
    finishedAt: new Date().toISOString(),
    results
  };
  const path = await writeRunResult(run);
  printSummary(results, path);
  return { run, path };
}

export async function runLockedOnly(serial: string, pauseMs: number): Promise<{ run: RunResult; path: string }> {
  const runId = makeRunId();
  const startedAt = new Date().toISOString();
  const device = new Adb();
  const browser = new AndroidChromeBrowser();
  const ctx: TestContext = { serial, device, browser, pauseMs };
  const results: TestResult[] = [];

  try {
    results.push(await runScreenOffBackgroundOnly(ctx));
  } finally {
    await settleCleanup(browser.disconnect());
    await settleCleanup(device.wakeScreen(serial));
  }

  const run: RunResult = {
    runId,
    serial,
    startedAt,
    finishedAt: new Date().toISOString(),
    results
  };
  const path = await writeRunResult(run);
  printSummary(results, path);
  return { run, path };
}

async function runSelected(serial: string, pauseMs: number, fullMatrix: boolean): Promise<{ run: RunResult; path: string }> {
  const runId = makeRunId();
  const startedAt = new Date().toISOString();
  const device = new Adb();
  const browser = new AndroidChromeBrowser();
  const ctx: TestContext = { serial, device, browser, pauseMs };
  const results: TestResult[] = [];

  try {
    const baseline = await runBaseline(ctx);
    results.push(baseline);

    if (fullMatrix && baseline.status === 'PASS') {
      await device.wakeScreen(serial).catch(() => undefined);
      await device.launchChrome(serial).catch(() => undefined);
      results.push(await runScreenOff(ctx));

      await device.wakeScreen(serial).catch(() => undefined);
      await device.launchChrome(serial).catch(() => undefined);
      results.push(await runChromeBackground(ctx));

      await device.wakeScreen(serial).catch(() => undefined);
      await device.launchChrome(serial).catch(() => undefined);
      results.push(await runScreenOffBackground(ctx));
    }
  } finally {
    await settleCleanup(device.wakeScreen(serial));
    await settleCleanup(device.launchChrome(serial));
    await settleCleanup(browser.disconnect());
  }

  const run: RunResult = {
    runId,
    serial,
    startedAt,
    finishedAt: new Date().toISOString(),
    results
  };
  const path = await writeRunResult(run);
  printSummary(results, path);
  return { run, path };
}

async function settleCleanup(promise: Promise<unknown>): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      promise,
      new Promise((resolve) => {
        timer = setTimeout(resolve, 5_000);
      })
    ]);
  } catch {
    // Cleanup is best-effort; the result file carries the actual test failure.
  } finally {
    if (timer) clearTimeout(timer);
  }
}
