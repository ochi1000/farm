import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { start, stop, status, events, runFile, latest } from './simulation.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reportPath = path.join(root, 'results', 'simulation-batch.json');
if (process.argv.includes('--detach')) {
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--repeat', '10'], { cwd: root, detached: true, windowsHide: true, stdio: 'ignore' });
  child.unref();
  console.log(JSON.stringify({ pid: child.pid, reportPath }));
} else {
  const report = { pid: process.pid, startedAt: new Date().toISOString(), state: 'running', cases: [] };
  const save = () => { fs.writeFileSync(reportPath + '.tmp', JSON.stringify(report, null, 2)); fs.renameSync(reportPath + '.tmp', reportPath); };
  const until = async (id, predicate, timeout = 6000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) { const s = status(id); if (predicate(s, events(id))) return s; await new Promise(r => setTimeout(r, 30)); }
    throw new Error(`Timed out: ${id}`);
  };
  const finished = id => until(id, s => ['completed', 'stopped', 'failed'].includes(s.state));
  const launch = options => {
    const commandId = randomUUID();
    const s = start({ brainMode: 'deterministic', commandId, cycles: 1, stepMs: 30, waitMs: 10, ...options });
    assert.equal(s.state, 'starting', 'Another simulation is active');
    assert.equal(start({ commandId }).id, s.id);
    return s;
  };
  const test = async (name, fn) => { const begin = Date.now(); await fn(); report.cases.push({ name, passed: true, durationMs: Date.now() - begin }); save(); };
  try {
    const previous = latest();
    assert.ok(!previous || ['completed', 'stopped', 'failed', 'interrupted'].includes(previous.state), 'Stop the active simulation before running lifecycle tests.');
    save();
    const repeat = process.argv.includes('--repeat') ? Number(process.argv[process.argv.indexOf('--repeat') + 1]) : 1;
    for (let iteration = 0; iteration < repeat; iteration++) {
      await test('normal sequence and durable replay', async () => {
        const s = launch({}); const end = await finished(s.id);
        assert.equal(end.state, 'completed'); assert.equal(end.completed, 7);
        assert.equal(end.persona.id, 'practical-tech');
        const journal = events(s.id); assert.equal(journal.filter(e => e.type === 'action_verified').length, 7);
        assert.equal(journal.filter(e => e.type === 'persona_decision').length, 7);
        assert.ok(journal.some(e => e.type === 'draft_ready' && e.message.includes('automation')));
        assert.deepEqual(events(s.id, journal[3].sequence), journal.slice(4));
        assert.equal(JSON.parse(fs.readFileSync(runFile(s.id, 'report.json'))).liveSubmissions, 0);
      });
      for (const phase of ['starting', 'waiting', 'inference', 'before_submit', 'after_submit']) await test(`stop at ${phase}`, async () => {
        const s = launch({ stepMs: 50, waitMs: 5000, faultStep: 1, fault: phase === 'inference' ? 'inference' : 'none', ...(phase.includes('submit') ? { faultStep: 2, fault: phase, waitMs: 0 } : {}) });
        if (phase !== 'starting') await until(s.id, (_s, es) => es.some(e => e.type === phase));
        stop(s.id); stop(s.id); const end = await finished(s.id);
        assert.equal(end.state, 'stopped'); assert.ok(end.stopLatencyMs < 2000);
        const journal = events(s.id), accepted = journal.find(e => e.type === 'stop_requested');
        assert.ok(accepted);
        assert.equal(journal.filter(e => e.sequence > accepted.sequence && ['action_started', 'submission_started'].includes(e.type)).length, 0);
      });
      for (const fault of ['error', 'hang']) await test(`failure: ${fault}`, async () => {
        const s = launch({ fault, faultStep: 1, timeoutMs: 250 }); const end = await finished(s.id);
        assert.equal(end.state, 'failed'); assert.equal(end.completed, 0);
        assert.equal(events(s.id).filter(e => e.type === 'action_started').length, 1);
      });
      await test('controller detach/reconnect receives persisted progress', async () => {
        const { default: createController } = await import('../desktop/simulation.cjs');
        const updates = [];
        const controller = createController(message => updates.push(message));
        const s = launch({ waitMs: 200 }); await controller('simulationStatus');
        await finished(s.id);
        await new Promise(r => setTimeout(r, 300));
        assert.ok(updates.some(u => u.events.some(e => e.type === 'action_verified')));
        const reopened = createController(() => {});
        const recovered = await reopened('simulationStatus');
        assert.equal(recovered.state.id, s.id); assert.equal(recovered.state.state, 'completed');
        assert.ok(recovered.events.some(e => e.type === 'finished'));
        await controller('dispose'); await reopened('dispose');
      });
      if (iteration === 0) await test('supervisor crash recovery', async () => {
        const s = launch({ fault: 'hang', faultStep: 1, timeoutMs: 30000 });
        await until(s.id, (_s, es) => es.some(e => e.type === 'action_started'));
        // This PID is from the supervisor this test just launched, not a stale lease.
        process.kill(s.pid);
        await new Promise(r => setTimeout(r, 15500));
        const recovered = status(s.id);
        assert.equal(recovered.state, 'interrupted');
        assert.equal(JSON.parse(fs.readFileSync(runFile(s.id, 'report.json'))).cleanup, 'unconfirmed');
      });
    }
    report.state = 'passed';
  } catch (error) { report.state = 'failed'; report.error = error.message; process.exitCode = 1; }
  finally { report.finishedAt = new Date().toISOString(); save(); console.log(JSON.stringify({ state: report.state, cases: report.cases.length, error: report.error, reportPath })); }
}
