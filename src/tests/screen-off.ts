import type { PageObservation } from '../browser/types.js';
import type { TestResult } from '../runner/result.js';
import { finishTest, observationsChanged, runStep, wait, type TestContext } from './helpers.js';

export async function runScreenOff(ctx: TestContext): Promise<TestResult> {
  const testName = 'T2 screen off';
  const startedAt = new Date().toISOString();
  const steps: TestResult['steps'] = [];
  let before: PageObservation | undefined;
  let afterScroll: PageObservation | undefined;

  await runStep(steps, 'turn screen off', async () => {
    await ctx.device.turnScreenOff(ctx.serial);
    await wait(ctx.pauseMs);
  }, true);
  await runStep(steps, 'observe screen off', async () => {
    before = await ctx.browser.observe();
    return before;
  }, true);
  await runStep(steps, 'scroll screen off', async () => {
    await ctx.browser.scrollOnce();
  }, true);
  await runStep(steps, 'observe after scroll', async () => {
    afterScroll = await ctx.browser.observe();
    return afterScroll;
  }, true);
  await runStep(steps, 'classify progress', async () => {
    if (!observationsChanged(before, afterScroll)) throw new Error('Observation did not change while screen was off');
    return { changed: true };
  }, true);

  return await finishTest(testName, startedAt, ctx, steps);
}

