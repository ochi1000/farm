import { randomInt } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { integer, parseArgs, required } from './cli.js';
import { XWorkflowRunner } from './runner.js';
import type { XTaskOutput } from './types.js';

type Cycle = {
  index: number;
  action: 'read_feed' | 'scroll_feed';
  startedAt: string;
  finishedAt: string;
  status: 'passed' | 'failed';
  output?: XTaskOutput;
  error?: string;
  waitAfterSeconds?: number;
};

async function main(): Promise<void> {
  const values = parseArgs(process.argv.slice(2));
  const serial = required(values, 'serial');
  const accountId = String(values.account || 'x-lab-account');
  const deviceId = String(values.device || serial);
  const durationMs = values['duration-seconds'] !== undefined
    ? integer(values['duration-seconds'], 'duration-seconds') * 1_000
    : integer(values['duration-minutes'] || '180', 'duration-minutes') * 60_000;
  const minWaitSeconds = integer(values['min-wait-seconds'] || '420', 'min-wait-seconds');
  const maxWaitSeconds = integer(values['max-wait-seconds'] || '900', 'max-wait-seconds');
  const initialWaitSeconds = values['initial-wait-seconds'] !== undefined
    ? integer(values['initial-wait-seconds'], 'initial-wait-seconds')
    : 0;
  const maxCycles = integer(values['max-cycles'] || '18', 'max-cycles');
  if (durationMs < 1_000) throw new Error('Duration must be at least one second.');
  if (initialWaitSeconds < 0) throw new Error('initial-wait-seconds must not be negative.');
  if (minWaitSeconds < 1 || maxWaitSeconds < minWaitSeconds) throw new Error('Wait range is invalid.');
  if (maxCycles < 1 || maxCycles > 100) throw new Error('max-cycles must be between 1 and 100.');

  const startedAt = new Date().toISOString();
  const deadline = Date.now() + durationMs;
  const runner = new XWorkflowRunner();
  const cycles: Cycle[] = [];
  try {
    if (initialWaitSeconds > 0) {
      console.log(JSON.stringify({ type: 'cooldown', waitSeconds: initialWaitSeconds }));
      await wait(Math.min(initialWaitSeconds * 1_000, Math.max(0, deadline - Date.now())));
    }
    for (let index = 0; index < maxCycles && Date.now() < deadline; index += 1) {
      const action = index % 2 === 0 ? 'read_feed' : 'scroll_feed';
      const cycle: Cycle = { index: index + 1, action, startedAt: new Date().toISOString(), finishedAt: '', status: 'passed' };
      try {
        cycle.output = await runner.execute({
          accountId,
          deviceId,
          serial,
          action,
          mode: 'dry-run',
          payload: action === 'read_feed' ? { limit: 5 } : { scrolls: 1, limit: 5 },
          idempotencyKey: `intermittent:${startedAt}:${index + 1}`,
          closeTabAfter: true
        });
      } catch (error) {
        cycle.status = 'failed';
        cycle.error = error instanceof Error ? error.message : String(error);
      }
      cycle.finishedAt = new Date().toISOString();
      cycles.push(cycle);
      console.log(JSON.stringify({ type: 'cycle', ...cycle }));
      if (cycle.error && /signed out|login|human verification|identity verification|unusual activity|account restriction|rate limit/i.test(cycle.error)) break;
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0 || index + 1 >= maxCycles) break;
      const waitSeconds = randomInt(minWaitSeconds, maxWaitSeconds + 1);
      cycle.waitAfterSeconds = Math.min(waitSeconds, Math.floor(remainingMs / 1_000));
      await wait(cycle.waitAfterSeconds * 1_000);
    }
  } finally {
    runner.close();
  }

  const report = {
    test: 'X screen-off intermittent read-only session',
    deviceId,
    serial,
    accountId,
    startedAt,
    finishedAt: new Date().toISOString(),
    requestedDurationMs: durationMs,
    initialWaitSeconds,
    passedCycles: cycles.filter((cycle) => cycle.status === 'passed').length,
    failedCycles: cycles.filter((cycle) => cycle.status === 'failed').length,
    popups: cycles.flatMap((cycle) => cycle.output?.session.popups || []),
    cycles
  };
  await mkdir('results', { recursive: true });
  const path = join('results', `x-intermittent-${startedAt.replace(/[:.]/g, '-')}.json`);
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ type: 'summary', ok: report.failedCycles === 0, path, ...report }));
  if (report.failedCycles) process.exitCode = 1;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(JSON.stringify({ type: 'fatal', error: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
});
