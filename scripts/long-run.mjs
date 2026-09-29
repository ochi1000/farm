import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = path.join(root, 'results', 'long-runs');
const file = (id, name) => {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('Invalid run ID');
  return path.join(base, id, name);
};
const write = (id, name, value) => {
  const target = file(id, name);
  fs.writeFileSync(target + '.tmp', JSON.stringify(value, null, 2));
  fs.renameSync(target + '.tmp', target);
};
export function status(id) {
  const value = JSON.parse(fs.readFileSync(file(id, 'status.json'), 'utf8'));
  if (!value.finishedAt && Date.now() - Date.parse(value.heartbeatAt) > 90000) value.state = 'unresponsive';
  return value;
}
export function stop(id) {
  const value = status(id);
  if (!value.finishedAt) fs.writeFileSync(file(id, 'stop'), 'stop');
  return { ...value, stopRequested: !value.finishedAt };
}
export function start(options) {
  if (!options.serial || !options.deviceId) throw new Error('serial and deviceId are required');
  const durationSeconds = Number(options.durationSeconds ?? 10800);
  const waitSeconds = Number(options.waitSeconds ?? 600);
  const maxCycles = Number(options.maxCycles ?? 18);
  if (![durationSeconds, waitSeconds, maxCycles].every(Number.isSafeInteger) || durationSeconds < 1 || durationSeconds > 86400 || waitSeconds < 1 || waitSeconds > 3600 || maxCycles < 1 || maxCycles > 100) throw new Error('Invalid run limits');
  fs.mkdirSync(base, { recursive: true });
  if (durationSeconds >= 1800) {
    const smokePassed = fs.readdirSync(base, { withFileTypes: true }).filter(entry => entry.isDirectory()).some(entry => {
      try {
        const report = JSON.parse(fs.readFileSync(file(entry.name, 'report.json'), 'utf8'));
        return report.deviceId === options.deviceId && report.state === 'completed' && report.completedCycles > 0 && Date.now() - Date.parse(report.finishedAt) < 3600000;
      } catch { return false; }
    });
    if (!smokePassed) throw new Error('Run a successful short smoke test on this device within the last hour first.');
  }
  // A per-device exclusive lock also prevents simultaneous starts from different controllers.
  const lock = path.join(base, Buffer.from(String(options.deviceId)).toString('hex') + '.lock');
  const fd = fs.openSync(lock, 'wx');
  const id = randomUUID();
  try {
    fs.mkdirSync(path.dirname(file(id, 'status.json')));
    const config = { serial: String(options.serial), deviceId: String(options.deviceId), accountId: String(options.accountId || 'x-lab-account'), durationSeconds, waitSeconds, maxCycles };
    write(id, 'config.json', config);
    write(id, 'status.json', { id, deviceId: config.deviceId, state: 'starting', actionClass: 'read-only', startedAt: new Date().toISOString(), heartbeatAt: new Date().toISOString(), reportPath: file(id, 'report.json') });
    const child = spawn(process.execPath, ['--import', 'tsx', fileURLToPath(import.meta.url), 'worker', id], { cwd: root, detached: true, windowsHide: true, stdio: 'ignore', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
    child.on('error', () => { write(id, 'status.json', { ...status(id), state: 'failed', finishedAt: new Date().toISOString() }); fs.rmSync(lock, { force: true }); });
    child.unref();
    fs.writeFileSync(fd, id);
    return { ...status(id), pid: child.pid };
  } catch (error) { fs.rmSync(lock, { force: true }); throw error; }
  finally { fs.closeSync(fd); }
}

async function worker(id) {
  const config = JSON.parse(fs.readFileSync(file(id, 'config.json'), 'utf8'));
  let state = { ...status(id), pid: process.pid, state: 'running', completedCycles: 0 };
  const cycles = [];
  const heartbeat = () => write(id, 'status.json', { ...state, heartbeatAt: new Date().toISOString() });
  const timer = setInterval(heartbeat, 30000);
  const stopped = () => fs.existsSync(file(id, 'stop'));
  const deadline = Date.now() + config.durationSeconds * 1000;
  let runner;
  try {
    // Allow the controller to receive the run ID before the first operation.
    await new Promise(resolve => setTimeout(resolve, 1500));
    const { XWorkflowRunner } = await import('../src/x-automation/runner.ts');
    runner = new XWorkflowRunner();
    while (!stopped() && Date.now() < deadline && cycles.length < config.maxCycles) {
      const action = cycles.length % 2 ? 'scroll_feed' : 'read_feed';
      state.phase = 'cycle'; heartbeat();
      try {
        const output = await runner.execute({ ...config, action, mode: 'dry-run', payload: { limit: 5, scrolls: 1 }, closeTabAfter: true, idempotencyKey: `long-run:${id}:${cycles.length}` });
        cycles.push({ action, status: 'passed', postCount: output.posts?.length || 0, screenOffMaintained: output.screenOffMaintained });
      } catch {
        cycles.push({ action, status: 'failed', reason: 'Workflow failed; manual review required.' });
        state.state = 'failed'; break;
      }
      state.completedCycles = cycles.length;
      state.phase = 'waiting'; heartbeat();
      const until = Math.min(deadline, Date.now() + config.waitSeconds * 1000);
      while (!stopped() && cycles.length < config.maxCycles && Date.now() < until) await new Promise(resolve => setTimeout(resolve, Math.min(1000, until - Date.now())));
    }
    if (state.state !== 'failed') state.state = stopped() ? 'stopped' : 'completed';
  } catch { state.state = 'failed'; }
  finally {
    clearInterval(timer);
    runner?.close();
    state = { ...state, completedCycles: cycles.length, finishedAt: new Date().toISOString(), phase: 'finished' };
    write(id, 'report.json', { ...state, cycles });
    heartbeat();
    fs.rmSync(file(id, 'config.json'), { force: true });
    fs.rmSync(path.join(base, Buffer.from(config.deviceId).toString('hex') + '.lock'), { force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, value] = process.argv.slice(2);
  try {
    if (command === 'worker') await worker(value);
    else if (command === 'start') console.log(JSON.stringify(start(JSON.parse(value))));
    else if (command === 'status') console.log(JSON.stringify(status(value)));
    else if (command === 'stop') console.log(JSON.stringify(stop(value)));
    else throw new Error('Usage: long-run.mjs start <JSON options> | status <run-id> | stop <run-id>');
  } catch { console.error('Long-run command failed. Check arguments, run files, and device lock.'); process.exitCode = 1; }
}
