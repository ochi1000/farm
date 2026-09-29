import type { PageObservation } from '../browser/types.js';
import type { TestResult } from '../runner/result.js';
import { finishTest, observationsChanged, runStep, wait, type TestContext } from './helpers.js';

export async function runChromeBackground(ctx: TestContext): Promise<TestResult> {
  const testName = 'T3 Chrome background';
  const startedAt = new Date().toISOString();
  const steps: TestResult['steps'] = [];
  let before: PageObservation | undefined;
  let afterAction: PageObservation | undefined;

  await runStep(steps, 'wake screen', async () => {
    await ctx.device.wakeScreen(ctx.serial);
  }, true);
  await runStep(steps, 'background Chrome', async () => {
    await ctx.device.backgroundChrome(ctx.serial);
    await wait(ctx.pauseMs);
  }, true);
  await runStep(steps, 'observe backgrounded', async () => {
    before = await ctx.browser.observe();
    return before;
  }, true);
  await runStep(steps, 'attempt scroll backgrounded', async () => {
    await ctx.browser.scrollOnce();
  }, true);
  await runStep(steps, 'attempt open visible post backgrounded', async () => {
    await ctx.browser.openVisiblePost(0);
  }, true);
  await runStep(steps, 'observe after background actions', async () => {
    afterAction = await ctx.browser.observe();
    return afterAction;
  }, true);
  await runStep(steps, 'classify progress', async () => {
    if (!observationsChanged(before, afterAction)) throw new Error('Observation did not change while Chrome was backgrounded');
    return { changed: true };
  }, true);

  return await finishTest(testName, startedAt, ctx, steps);
}

