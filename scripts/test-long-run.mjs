import assert from 'node:assert/strict';
import fs from 'node:fs';
import { start, status, stop } from './long-run.mjs';

const deviceId = `orchestration-test-${Date.now()}`;
assert.throws(() => start({ serial: 'unused', deviceId, maxCycles: 101 }));
const run = start({ serial: 'unused-no-device', deviceId, durationSeconds: 5 });
assert.ok(run.pid);
assert.throws(() => start({ serial: 'unused', deviceId }));
assert.equal(stop(run.id).stopRequested, true);
let result;
const deadline = Date.now() + 20000;
do {
  await new Promise(resolve => setTimeout(resolve, 250));
  result = status(run.id);
} while (!result.finishedAt && Date.now() < deadline);
assert.equal(result.state, 'stopped');
assert.equal(result.completedCycles, 0);
assert.equal(JSON.parse(fs.readFileSync(result.reportPath)).cycles.length, 0);
assert.equal(stop(run.id).stopRequested, false);
fs.writeFileSync('results/long-run-orchestration-test.json', JSON.stringify({ passed: true, runId: run.id, checks: ['invalid limits', 'detached startup', 'duplicate device lock', 'cooperative stop', 'final report', 'idempotent stop'], liveDeviceTest: false }, null, 2));
console.log('PASS: detached startup, exclusive device lock, stop, and final report (no device operations).');
