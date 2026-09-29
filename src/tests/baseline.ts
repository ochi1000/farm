import type { PageObservation } from '../browser/types.js';
import type { TestResult } from '../runner/result.js';
import { finishTest, observationsChanged, runStep, wait, type TestContext } from './helpers.js';

export async function runBaseline(ctx: TestContext): Promise<TestResult> {
  const testName = 'T1 baseline';
  const startedAt = new Date().toISOString();
  const steps: TestResult['steps'] = [];
  let error: unknown;
  let before: PageObservation | undefined;
  let afterScroll: PageObservation | undefined;

  try {
    await runStep(steps, 'wake screen', async () => {
      await ctx.device.wakeScreen(ctx.serial);
    });
    await runStep(steps, 'launch Chrome', async () => {
      await ctx.device.launchChrome(ctx.serial);
      await wait(ctx.pauseMs);
    });
    await runStep(steps, 'connect browser', async () => {
      await ctx.browser.connect(ctx.serial);
    });
    await runStep(steps, 'ensure X open', async () => {
      await ctx.browser.ensureXOpen();
    });
    await runStep(steps, 'observe initial', async () => {
      before = await ctx.browser.observe();
      return before;
    });
    await runStep(steps, 'scroll', async () => {
      await ctx.browser.scrollOnce();
    });
    await runStep(steps, 'observe after scroll', async () => {
      afterScroll = await ctx.browser.observe();
      return afterScroll;
    });
    await runStep(steps, 'verify observation changed', async () => {
      if (!observationsChanged(before, afterScroll)) throw new Error('Observation did not change after scroll');
      return { changed: true };
    });
    await runStep(steps, 'open visible post', async () => {
      await ctx.browser.openVisiblePost(0);
    });
    await runStep(steps, 'navigate back', async () => {
      await ctx.browser.goBack();
    });
  } catch (caught) {
    error = caught;
  }

  return await finishTest(testName, startedAt, ctx, steps, error);
}

