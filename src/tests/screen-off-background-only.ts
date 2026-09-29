import type { PageObservation } from '../browser/types.js';
import type { TestResult } from '../runner/result.js';
import { finishTest, observationsChanged, runStep, wait, type TestContext } from './helpers.js';

export async function runScreenOffBackgroundOnly(ctx: TestContext): Promise<TestResult> {
  const testName = 'T-screen-off background CDP only';
  const startedAt = new Date().toISOString();
  const steps: TestResult['steps'] = [];
  let before: PageObservation | undefined;
  let afterScroll: PageObservation | undefined;
  let error: unknown;

  try {
    await runStep(steps, 'wake screen', async () => {
      await ctx.device.wakeScreen(ctx.serial);
    });
    await runStep(steps, 'launch X in Chrome', async () => {
      await ctx.device.launchChrome(ctx.serial);
      await wait(ctx.pauseMs);
    });
    await runStep(steps, 'connect browser over CDP', async () => {
      await ctx.browser.connect(ctx.serial);
    });
    await runStep(steps, 'ensure X ready', async () => {
      await ctx.browser.ensureXOpen();
    });
    await runStep(steps, 'background Chrome', async () => {
      await ctx.device.backgroundChrome(ctx.serial);
      await wait(ctx.pauseMs);
    });
    await runStep(steps, 'turn screen off', async () => {
      await ctx.device.turnScreenOff(ctx.serial);
      await wait(ctx.pauseMs);
    });
    await runStep(steps, 'observe screen off backgrounded', async () => {
      before = await ctx.browser.observe();
      return before;
    }, true);
    await runStep(steps, 'DOM scroll screen off backgrounded', async () => {
      await ctx.browser.scrollOnce();
    }, true);
    await runStep(steps, 'observe after screen off scroll', async () => {
      afterScroll = await ctx.browser.observe();
      return afterScroll;
    }, true);
    await runStep(steps, 'verify screen off progress', async () => {
      if (!observationsChanged(before, afterScroll)) throw new Error('Observation did not change while screen was off and Chrome was backgrounded');
      return { changed: true };
    }, true);
  } catch (caught) {
    error = caught;
  }

  return await finishTest(testName, startedAt, ctx, steps, error);
}
