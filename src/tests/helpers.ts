import type { BrowserController, PageObservation } from '../browser/types.js';
import { config } from '../config.js';
import type { DeviceController } from '../device/types.js';
import { describePhoneState } from '../device/device-state.js';
import { errorMessage, statusFromSteps, type StepResult, type TestResult } from '../runner/result.js';

export type TestContext = {
  serial: string;
  device: DeviceController;
  browser: BrowserController;
  pauseMs: number;
};

export async function wait(ms: number): Promise<void> {
  if (ms > 0) await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runStep(
  steps: StepResult[],
  name: string,
  action: () => Promise<Record<string, unknown> | PageObservation | void>,
  inconclusiveOnFailure = false
): Promise<void> {
  const startedAt = new Date().toISOString();
  console.log(`  ${name}...`);
  try {
    const result = await withTimeout(action(), stepTimeoutMs(), `Step timed out: ${name}`);
    const observation = isObservation(result) ? result : undefined;
    const details = result && !observation ? result : undefined;
    steps.push({ name, startedAt, finishedAt: new Date().toISOString(), status: 'PASS', details, observation });
    console.log(`  ${name} PASS`);
  } catch (error) {
    steps.push({
      name,
      startedAt,
      finishedAt: new Date().toISOString(),
      status: inconclusiveOnFailure ? 'INCONCLUSIVE' : 'FAIL',
      error: errorMessage(error)
    });
    console.log(`  ${name} ${inconclusiveOnFailure ? 'INCONCLUSIVE' : 'FAIL'} - ${errorMessage(error)}`);
    if (!inconclusiveOnFailure) throw error;
  }
}

export async function finishTest(
  testName: string,
  startedAt: string,
  ctx: TestContext,
  steps: StepResult[],
  error?: unknown
): Promise<TestResult> {
  const phoneState = await describePhoneState(ctx.device, ctx.serial);
  const status = error ? 'FAIL' : statusFromSteps(steps);
  return {
    testName,
    startedAt,
    finishedAt: new Date().toISOString(),
    phoneState,
    steps,
    status,
    error: error ? errorMessage(error) : undefined
  };
}

export function observationsChanged(before?: PageObservation, after?: PageObservation): boolean {
  if (!before || !after) return false;
  if (before.url && after.url && before.url !== after.url) return true;
  if (before.visibleTextSample && after.visibleTextSample && before.visibleTextSample !== after.visibleTextSample) return true;
  if (before.scrollTop !== undefined && after.scrollTop !== undefined && before.scrollTop !== after.scrollTop) return true;
  return before.visiblePostCount !== undefined && after.visiblePostCount !== undefined && before.visiblePostCount !== after.visiblePostCount;
}

function isObservation(value: unknown): value is PageObservation {
  return Boolean(value && typeof value === 'object' && 'timestamp' in value);
}

function stepTimeoutMs(): number {
  return Math.max(config.adbTimeoutMs, config.browserTimeoutMs) + 5_000;
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
