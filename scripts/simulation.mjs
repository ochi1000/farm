import fs from 'node:fs';
import { contextualFixture, fixtureVersion } from './contextual-fixtures.mjs';
import { brainConfig, contextualDecision } from './contextual-brain.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { spawn, fork } from 'node:child_process';
import { loadPersona, createFixture, decide, applyDecision } from './simulation-persona.mjs';

const script = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(script), '..');
const base = path.join(root, 'results', 'automation');
const control = path.join(root, '.automation', 'simulation');
const terminal = s => ['completed', 'stopped', 'failed', 'interrupted'].includes(s);
export const actions = ['view_post', 'like_post', 'comment_post', 'read_comments', 'reply_to_comment', 'create_post', 'scroll_feed'];
const now = () => new Date().toISOString();
export function runFile(id, name) {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) throw new Error('Invalid run ID');
  return path.join(base, id, name);
}
function json(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function atomic(file, value) {
  const temp = file + '.' + randomUUID() + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(value, null, 2));
  // Windows readers/antivirus can briefly hold the destination open.
  for (let attempt = 0; ; attempt++) {
    try { fs.renameSync(temp, file); break; }
    catch (error) {
      if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= 40) { fs.rmSync(temp, { force: true }); throw error; }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
    }
  }
}
function report(state) {
  atomic(runFile(state.id, 'report.json'), { ...state, trace: events(state.id) });
  fs.writeFileSync(runFile(state.id, 'report.md'), `# Simulation report\n\nRun: ${state.id}\n\nOutcome: **${state.state}**\n\nProcessed steps: ${state.completed}/${state.total}\n\nSimulated actions verified: ${state.completed - (state.skipped || 0)}\n\nSkipped: ${state.skipped || 0}\n\nPersona: ${state.persona?.name || "Legacy fixture"}\n\nLive submissions: 0\n\nStop latency: ${state.stopLatencyMs ?? 'N/A'} ms\n\nError: ${state.error || 'None'}\n\nCleanup: ${state.cleanup || 'complete'}\n`);
  fs.appendFileSync(runFile(state.id, 'report.md'), `\nBrain: ${state.brain?.model || state.brain?.mode || 'legacy'}\n\nModel metrics: ${JSON.stringify(state.modelMetrics || {})}\n\n## Decisions and reviews\n\n` + events(state.id).filter(e => ['persona_decision', 'draft_proposed', 'quality_review', 'review_invalid', 'error'].includes(e.type)).map(e => `- Step ${e.stepId}: ${e.type} | ${e.targetId || ''} | ${e.message || e.reason || ''}${e.text ? ' | Draft: ' + e.text : ''}${e.verdict ? ' | Verdict: ' + e.verdict + ' / ' + e.category : ''}${e.priorId ? ' | Prior: ' + e.priorId + ' | Evidence: ' + e.priorQuote + ' | Shared idea: ' + e.repeatedIdea : ''}`).join('\n'));
}
export function status(id) {
  let state = json(runFile(id, 'status.json'));
  if (!terminal(state.state) && Date.now() - Date.parse(state.heartbeatAt) > 15000) {
    let alive = true;
    try { process.kill(state.pid, 0); } catch (error) { if (error.code === 'ESRCH') alive = false; }
    if (!alive) {
      state = { ...state, state: 'interrupted', finishedAt: now(), error: 'Supervisor exited unexpectedly; no automatic replay.', cleanup: 'unconfirmed' };
      report(state); atomic(runFile(id, 'status.json'), state);
    } else state = { ...state, unresponsive: true };
  }
  return state;
}
export function history() {
  if (!fs.existsSync(base)) return [];
  return fs.readdirSync(base).flatMap(id => { try { return [status(id)]; } catch { return []; } }).sort((a,b) => b.startedAt.localeCompare(a.startedAt)).slice(0,50);
}
export function latest() {
  try { return status(json(path.join(control, 'latest.json')).id); } catch { return null; }
}
export function events(id, after = 0) {
  const file = runFile(id, 'events.jsonl');
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).flatMap(line => {
    try { const event = JSON.parse(line); return event.sequence > after ? [event] : []; } catch { return []; }
  });
}
export function stop(id) {
  const state = status(id);
  if (!terminal(state.state)) {
    try { fs.writeFileSync(runFile(id, 'stop.json'), JSON.stringify({ requestedAt: now() }), { flag: 'wx' }); } catch (e) { if (e.code !== 'EEXIST') throw e; }
  }
  return { ...state, stopRequested: !terminal(state.state) };
}
export function start(options = {}) {
  const commandId = String(options.commandId || randomUUID());
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(commandId)) throw new Error('Invalid command ID');
  if (options.mode && options.mode !== 'simulation') throw new Error('Only simulation is supported');
  const config = { schemaVersion: 1, mode: 'simulation', cycles: options.cycles ?? 3, stepMs: options.stepMs ?? 750, waitMs: options.waitMs ?? 1500, timeoutMs: options.timeoutMs ?? 130000, durationMs: options.durationMs ?? 300000, fault: options.fault ?? 'none', faultStep: options.faultStep ?? 3 };
  config.persona = loadPersona();
  config.fixtureId = options.fixtureId ?? 'default';
  config.fixtureVersion = fixtureVersion;
  config.initialFixture = contextualFixture(config.fixtureId);
  config.brainMode = options.brainMode ?? 'ollama';
  if (!['ollama', 'deterministic'].includes(config.brainMode)) throw new Error('Invalid brain mode');
  config.brain = config.brainMode === 'ollama' ? brainConfig(options.brain) : null;
  for (const [key, min, max] of [['cycles', 1, 100], ['stepMs', 10, 10000], ['waitMs', 0, 60000], ['timeoutMs', 100, 150000], ['durationMs', 100, 3600000], ['faultStep', 1, 700]]) {
    if (!Number.isInteger(config[key]) || config[key] < min || config[key] > max) throw new Error(`Invalid ${key}`);
  }
  if (!['none', 'error', 'hang', 'inference', 'before_submit', 'after_submit'].includes(config.fault)) throw new Error('Invalid fault');
  fs.mkdirSync(control, { recursive: true }); fs.mkdirSync(base, { recursive: true });
  const commandFile = path.join(control, commandId + '.json');
  if (fs.existsSync(commandFile)) return status(json(commandFile).id);
  const lock = path.join(control, 'lease.json');
  if (fs.existsSync(lock)) {
    const existing = status(json(lock).id);
    if (!terminal(existing.state)) {
      if (options.rejectIfBusy) throw new Error('Another simulation is running');
      return existing;
    }
    fs.unlinkSync(lock);
  }
  const id = randomUUID();
  // A single synthetic device/account lease. No real device resources are acquired.
  fs.writeFileSync(lock, JSON.stringify({ id }), { flag: 'wx' });
  fs.mkdirSync(path.dirname(runFile(id, 'status.json')));
  const state = { schemaVersion: 1, id, mode: 'simulation', state: 'starting', phase: 'startup', startedAt: now(), heartbeatAt: now(), completed: 0, total: config.cycles * actions.length, sequence: 0, liveSubmissions: 0, reportPath: runFile(id, 'report.md') };
  state.persona = { id: config.persona.id, version: config.persona.version, name: config.persona.name };
  state.skipped = 0;
  state.fixtureId = config.fixtureId;
  state.fixtureVersion = config.fixtureVersion;
  state.brain = { mode: config.brainMode, model: config.brain?.model, thinking: config.brain?.think, promptVersion: config.brain?.promptVersion };
  state.modelMetrics = { requests: 0, responses: 0, latencyMs: 0, inputTokens: 0, outputTokens: 0 };
  atomic(runFile(id, 'config.json'), config); atomic(runFile(id, 'status.json'), state);
  try {
    const child = spawn(process.execPath, [script, 'supervise', id], { cwd: root, detached: true, windowsHide: true, stdio: 'ignore', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
    // Keep launch metadata separate from supervisor-owned status.
    atomic(runFile(id, 'launch.json'), { pid: child.pid });
    child.once('error', () => { const failed = { ...state, state: 'failed', error: 'Supervisor launch failed', finishedAt: now() }; report(failed); atomic(runFile(id, 'status.json'), failed); });
    child.unref();
    atomic(commandFile, { id }); atomic(path.join(control, 'latest.json'), { id });
    return { ...state, pid: child.pid };
  } catch (error) { fs.rmSync(lock, { force: true }); throw error; }
}

async function supervise(id) {
  const config = json(runFile(id, 'config.json'));
  let state = { ...json(runFile(id, 'status.json')), pid: process.pid };
  let fixture = config.initialFixture || createFixture();
  let active, stopping = false;
  const snapshot = () => { state.heartbeatAt = now(); atomic(runFile(id, 'status.json'), state); };
  const emit = (type, details = {}) => {
    const event = { schemaVersion: 1, runId: id, sequence: ++state.sequence, timestamp: now(), type, stepId: state.currentStep || 0, ...details };
    fs.appendFileSync(runFile(id, 'events.jsonl'), JSON.stringify(event) + '\n');
    snapshot();
  };
  const checkStop = () => {
    if (stopping || !fs.existsSync(runFile(id, 'stop.json'))) return stopping;
    stopping = true; state.state = 'stopping'; state.stopRequestedAt = json(runFile(id, 'stop.json')).requestedAt;
    emit('stop_requested'); if (active?.connected) active.send({ type: 'cancel' }); return true;
  };
  const poll = setInterval(() => { try { checkStop(); } catch { active?.kill(); } }, 50);
  const heartbeat = setInterval(snapshot, 10000);
  const wait = async ms => {
    const end = Math.min(Date.now() + ms, Date.parse(state.startedAt) + config.durationMs);
    while (Date.now() < end && !checkStop()) await new Promise(resolve => setTimeout(resolve, Math.min(50, end - Date.now())));
  };
  try {
    snapshot(); emit('starting'); await wait(200);
    if (!stopping) { state.state = 'running'; emit('ready'); }
    for (let index = 0; index < state.total && !checkStop() && Date.now() < Date.parse(state.startedAt) + config.durationMs; index++) {
      state.currentStep = index + 1;
      state.phase = actions[index % actions.length]; emit('action_started', { action: state.phase });
      const outcome = await new Promise((resolve, reject) => {
        let result, submitted = false, cancelAt;
        active = fork(script, ['action'], { cwd: root, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
        const child = active;
        const deadline = Date.now() + config.timeoutMs;
        const guard = setInterval(() => {
          if (checkStop() || Date.now() >= Date.parse(state.startedAt) + config.durationMs) {
            cancelAt ??= Date.now();
            if (child.connected) child.send({ type: 'cancel' });
            if (Date.now() - cancelAt > 1000) child.kill();
          } else if (Date.now() > deadline) { result = { error: 'Action deadline exceeded' }; child.kill(); }
        }, 50);
        child.on('message', message => {
          try {
            if (message.type === 'permit') {
              const allowed = !checkStop() && Date.now() < Date.parse(state.startedAt) + config.durationMs;
              if (allowed) { submitted = true; emit('submission_started', { action: state.phase, certainty: 'simulated' }); }
              child.send({ type: allowed ? 'permit' : 'cancel' });
            } else if (message.type === 'phase') {
              const { type, phase, ...details } = message;
              if (phase === 'model_request') state.modelMetrics.requests++;
              if (phase === 'model_response') { state.modelMetrics.responses++; for (const key of ['latencyMs', 'inputTokens', 'outputTokens']) state.modelMetrics[key] += details[key] || 0; }
              emit(phase, { action: state.phase, ...details, ...(message.text && !message.message ? { message: message.text } : {}) });
            }
            else if (message.type === 'result') { result = message; if (message.fixture) fixture = message.fixture; if (child.connected) child.send({ type: 'ack' }); }
          } catch { result = { error: 'Event journal failed' }; child.kill(); }
        });
        child.once('error', () => { result = { error: 'Action worker failed to launch' }; });
        child.once('exit', () => {
          clearInterval(guard); active = null;
          if (result?.error) reject(Object.assign(new Error(result.error), { code: result.code }));
          else if (result?.skipped) resolve('skipped');
          else if (result?.verified) resolve('verified');
          else if (cancelAt || stopping) { if (submitted) state.uncertainSimulatedSubmission = true; resolve('cancelled'); }
          else reject(new Error('Action worker exited without verification'));
        });
        child.send({ type: 'start', action: state.phase, persona: config.persona, brain: config.brain, brainMode: config.brainMode, step: index + 1, fixture, delay: config.stepMs, fault: index + 1 === config.faultStep ? config.fault : 'none' });
      });
      if (outcome === 'cancelled') break;
      state.completed++; if (outcome === 'skipped') state.skipped++; emit(outcome === 'skipped' ? 'action_skipped' : 'action_verified', { action: state.phase, certainty: 'simulated' });
      state.phase = 'waiting'; emit('waiting'); await wait(config.waitMs);
    }
    state.state = stopping ? 'stopped' : 'completed';
    state.finishReason = stopping ? 'user_stop' : state.completed < state.total ? 'duration_limit' : 'sequence_complete';
  } catch (error) { state.state = 'failed'; state.error = error.message; state.errorCode = error.code || 'ACTION_FAILED'; emit('error', { message: state.error }); }
  finally {
    clearInterval(poll); clearInterval(heartbeat);
    state.finishedAt = now(); state.phase = 'finished'; state.cleanup = 'complete';
    if (state.stopRequestedAt) state.stopLatencyMs = Date.now() - Date.parse(state.stopRequestedAt);
    report(state);
    emit('cleanup'); emit('finished', { state: state.state }); report(state); snapshot();
  }
}

// Synthetic execution adapter with loopback-only model access; no device/account execution.
async function action() {
  let cancelled = false, release;
  const abort = new AbortController();
  const finish = result => { if (process.connected) process.send({ type: 'result', ...result }); };
  process.on('disconnect', () => process.exit(0));
  process.on('message', async message => {
    if (message.type === 'cancel') { cancelled = true; abort.abort(); release?.(); return; }
    if (message.type === 'permit') { release?.(); return; }
    if (message.type === 'ack') { if (process.connected) process.disconnect(); return; }
    if (message.type !== 'start') return;
    const delay = async ms => { const end = Date.now() + ms; while (!cancelled && Date.now() < end) await new Promise(r => setTimeout(r, Math.min(20, end - Date.now()))); };
    try {
      if (message.fault === 'hang') { while (true) await new Promise(r => setTimeout(r, 1000)); }
      if (message.fault === 'error') throw new Error('Injected action failure');
      const mutation = ['like_post', 'comment_post', 'reply_to_comment', 'create_post'].includes(message.action);
      process.send({ type: 'phase', phase: 'preparing' });
      if (message.fault === 'inference') { process.send({ type: 'phase', phase: 'inference' }); await delay(5000); }
      await delay(message.delay);
      if (cancelled) { finish({ cancelled: true }); return; }
      const decision = message.brainMode === 'deterministic'
        ? decide(message.persona, message.action, message.fixture, message.step)
        : await contextualDecision({ ...message, signal: abort.signal, emit: event => process.send({ type: 'phase', ...event }) });
      process.send({ type: 'phase', phase: 'persona_decision', ...decision, message: decision.reason });
      if (decision.skip) { finish({ skipped: true }); return; }
      if (!cancelled && decision.text) process.send({ type: 'phase', phase: 'draft_ready', text: decision.text });
      if (mutation && !cancelled) {
        if (message.fault === 'before_submit') { process.send({ type: 'phase', phase: 'before_submit' }); await delay(5000); }
        if (!cancelled) await new Promise(resolve => { release = resolve; process.send({ type: 'permit' }); });
      }
      if (cancelled) { finish({ cancelled: true }); return; }
      const fixture = message.fixture;
      const verified = applyDecision(fixture, decision, message.step);
      if (message.fault === 'after_submit') { process.send({ type: 'phase', phase: 'after_submit' }); await delay(5000); }
      fixture.memory = [...(fixture.memory || []), decision].slice(-12);
      finish({ verified, fixture });
    } catch (error) { finish(cancelled ? { cancelled: true } : { error: error.message, code: error.code }); }
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === script) {
  const [command, value] = process.argv.slice(2);
  if (command === 'supervise') await supervise(value);
  else if (command === 'action') await action();
  else if (command === 'start') console.log(JSON.stringify(start(value ? JSON.parse(value) : {})));
  else if (command === 'stop') console.log(JSON.stringify(stop(value)));
  else if (command === 'status') console.log(JSON.stringify(value ? status(value) : latest()));
}
