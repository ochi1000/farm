import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { start, stop, status, events, runFile } from './simulation.mjs';
import { brainConfig, tooSimilar, candidatesFor } from './contextual-brain.mjs';
import { fixtureIds, fixtureVersion, contextualFixture } from './contextual-fixtures.mjs';
import { loadPersona, applyDecision } from './simulation-persona.mjs';

const script = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(script), '..');
const base = path.join(root, 'results/contextual-batches');
const now = () => new Date().toISOString();
const terminal = s => Boolean(s.finishedAt) && ['completed', 'stopped', 'failed', 'interrupted'].includes(s.state);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
function save(file, value) {
  const temp = file + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(value, null, 2));
  for (let attempt = 0; ; attempt++) {
    try { fs.renameSync(temp, file); return; }
    catch (error) {
      if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt === 40) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
    }
  }
}
function directory(id) {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id || '')) throw new Error('Invalid batch ID');
  return path.join(base, id);
}
export function summarize(report, kind = 'quality') {
  const trace = report.trace;
  const verified = new Set(trace.filter(e => e.type === 'action_verified').map(e => e.stepId));
  const drafts = trace.filter(e => e.type === 'draft_ready' && verified.has(e.stepId));
  const configFile = runFile(report.id, 'config.json');
  const config = fs.existsSync(configFile) ? read(configFile) : null;
  const fixture = config?.initialFixture || contextualFixture(report.fixtureId);
  const persona = config?.persona || loadPersona();
  const skips = [];
  for (const event of trace) {
    const decision = trace.find(d => d.stepId === event.stepId && d.type === 'persona_decision');
    if (event.type === 'action_verified' && decision) applyDecision(fixture, decision, event.stepId);
    if (event.type === 'action_skipped') skips.push({ step: event.stepId, action: event.action, reason: decision?.reason,
      valid: Boolean(decision?.skip) && candidatesFor(persona, event.action, fixture, event.stepId).length === 0 });
  }
  const rejected = trace.filter(e => e.type === 'quality_review' && !e.accepted);
  const duplicates = [];
  for (let i = 0; i < drafts.length; i++) for (let j = 0; j < i; j++) if (tooSimilar(drafts[i].text, drafts[j].text)) duplicates.push([drafts[j].stepId, drafts[i].stepId]);
  const stopEvent = trace.find(e => e.type === 'stop_requested');
  const laterSubmissions = stopEvent ? trace.filter(e => e.type === 'submission_started' && e.sequence > stopEvent.sequence).length : 0;
  const category = report.errorCode === 'INVALID_REVIEW' ? 'reviewer_failure' : report.errorCode === 'QUALITY_REJECTED' ? 'review_rejection' : report.errorCode === 'REPETITIVE_TEXT' ? 'duplication_rejection' : /^INVALID_|UNGROUNDED|UNSUPPORTED_CLAIM|GENERIC_TEXT/.test(report.errorCode || '') ? 'validation_rejection' : report.errorCode ? 'execution_error' : report.state === 'interrupted' ? 'interrupted' : null;
  return { runId: report.id, fixtureId: report.fixtureId, kind, state: report.state, finishReason: report.finishReason,
    reportPath: runFile(report.id, 'report.json'), markdownPath: runFile(report.id, 'report.md'),
    completedCycles: Math.floor(report.completed / 7), requestedCycles: report.total / 7,
    processed: report.completed, skips, validSkipCount: skips.filter(s => s.valid).length,
    writingCategories: [...new Set(drafts.map(e => e.action))], verifiedDrafts: drafts.map(e => ({ step: e.stepId, action: e.action, text: e.text })),
    rejectedDrafts: trace.filter(e => e.type === 'plan_proposed' && !verified.has(e.stepId) && ['review_rejection', 'duplication_rejection', 'validation_rejection'].includes(category)).map(e => ({ step: e.stepId, action: e.action, proposal: e.proposal })),
    rejectedReviews: rejected.map(e => ({ step: e.stepId, verdict: e.verdict, category: e.category, draftQuote: e.draftQuote, priorId: e.priorId, priorQuote: e.priorQuote, repeatedIdea: e.repeatedIdea, relevant: e.relevant, grounded: e.grounded, notRepeated: e.notRepeated, reason: e.reason })),
    invalidReviewAttempts: trace.filter(e => e.type === 'review_invalid').length,
    category, errorCode: report.errorCode, error: report.error, withinSessionDuplicatePairs: duplicates,
    modelMetrics: report.modelMetrics, responseLatenciesMs: trace.filter(e => e.type === 'model_response').map(e => e.latencyMs),
    elapsedMs: Date.parse(report.finishedAt) - Date.parse(report.startedAt), stopLatencyMs: report.stopLatencyMs,
    stopObserved: Boolean(stopEvent), laterSubmissions, cleanup: report.cleanup,
    liveSubmissions: report.liveSubmissions };
}
export function aggregate(sessions) {
  const quality = sessions.filter(s => s.kind === 'quality');
  const latencies = quality.flatMap(s => s.responseLatenciesMs).sort((a,b) => a-b);
  const counts = {};
  for (const session of quality) if (session.category) counts[session.category] = (counts[session.category] || 0) + 1;
  const drafts = quality.flatMap(s => s.verifiedDrafts.map(d => ({ ...d, runId: s.runId })));
  let crossSessionDuplicatePairs = 0;
  for (let i = 0; i < drafts.length; i++) for (let j = 0; j < i; j++) if (drafts[i].runId !== drafts[j].runId && tooSimilar(drafts[i].text, drafts[j].text)) crossSessionDuplicatePairs++;
  return { qualitySessions: quality.length, fullyCompletedSessions: quality.filter(s => s.state === 'completed' && s.processed === s.requestedCycles * 7).length,
    completedCycles: quality.reduce((n,s) => n+s.completedCycles, 0), requestedCycles: quality.reduce((n,s) => n+s.requestedCycles, 0),
    validSkips: quality.reduce((n,s) => n+s.validSkipCount, 0), invalidSkips: quality.reduce((n,s) => n+s.skips.filter(v => !v.valid).length, 0), rejectedDrafts: quality.reduce((n,s) => n+s.rejectedDrafts.length, 0), failureCategories: counts,
    writingCategories: [...new Set(quality.flatMap(s => s.writingCategories))],
    withinSessionDuplicatePairs: quality.reduce((n,s) => n+s.withinSessionDuplicatePairs.length, 0), crossSessionDuplicatePairs,
    responseLatency: { count: latencies.length, medianMs: latencies.length ? latencies[Math.ceil(latencies.length * .5)-1] : null, p95Ms: latencies.length ? latencies[Math.ceil(latencies.length * .95)-1] : null, maxMs: latencies.at(-1) ?? null },
    invalidReviewAttempts: quality.reduce((n,s) => n + (s.invalidReviewAttempts || 0), 0),
    modelMetrics: quality.reduce((totals,s) => { for (const key of Object.keys(totals)) totals[key] += s.modelMetrics?.[key] || 0; return totals; }, { requests: 0, responses: 0, latencyMs: 0, inputTokens: 0, outputTokens: 0 }), liveSubmissions: 0 };
}

export async function runBatch(dir, config) {
  fs.mkdirSync(dir, { recursive: true });
  const report = { schemaVersion: 1, id: path.basename(dir), pid: process.pid, state: 'running', startedAt: now(), heartbeatAt: now(), config, sessions: [], liveSubmissions: 0,
    interpretation: 'Synthetic execution with local model judgments. Rejected drafts stop their session. Independent scenarios continue once each, without retry or fallback. Cross-session similarity is measured, not prevented. Response latency excludes failed/cancelled requests.' };
  let active;
  const batchDeadline = config.durationMs ? Date.now() + config.durationMs : Infinity;
  if (config.durationMs) report.deadlineAt = new Date(batchDeadline).toISOString();
  const stopped = () => fs.existsSync(path.join(dir, 'stop.json'));
  const persist = () => { report.heartbeatAt = now(); report.aggregate = aggregate(report.sessions); save(path.join(dir, 'report.json'), report); };
  persist();
  const heartbeat = setInterval(persist, 10000);
  async function session(fixtureId, cycles, kind) {
    if (stopped() || Date.now() >= batchDeadline) return;
    active = start({ fixtureId, cycles, brain: config.brain, stepMs: 10, waitMs: 0, durationMs: config.sessionDurationMs, rejectIfBusy: true });
    report.activeRunId = active.id; persist();
    const deadline = Date.now() + config.sessionDurationMs + 20000;
    let cancellationRequested = false;
    while (!terminal(status(active.id))) {
      if (stopped() || Date.now() >= batchDeadline) stop(active.id);
      if (kind === 'cancellation' && !cancellationRequested) {
        const journal = events(active.id);
        if (journal.filter(e => e.type === 'model_request').length > journal.filter(e => e.type === 'model_response').length) {
          stop(active.id); cancellationRequested = true;
        }
      }
      if (Date.now() > deadline) throw new Error('Session exceeded bounded completion deadline');
      await sleep(kind === 'cancellation' ? 20 : 500);
    }
    // A terminal snapshot can briefly precede the final journal/report flush.
    while (!read(runFile(active.id, 'report.json')).trace.some(e => e.type === 'finished')) {
      if (Date.now() > deadline) throw new Error('Final report flush deadline exceeded');
      await sleep(50);
    }
    const summary = summarize(read(runFile(active.id, 'report.json')), kind);
    report.sessions.push(summary); active = null; delete report.activeRunId; persist();
    if (kind === 'cancellation' && (!cancellationRequested || summary.state !== 'stopped' || !summary.stopObserved || summary.laterSubmissions || summary.stopLatencyMs > 2000 || summary.cleanup !== 'complete')) throw new Error('Active-inference cancellation acceptance failed');
  }
  try {
    if (config.preflightSmoke) {
      await session('garden', 1, 'smoke');
      const smoke = report.sessions.at(-1);
      if (stopped()) { report.finishReason = 'user_stop'; }
      else if (!smoke || smoke.state !== 'completed' || smoke.processed !== 7 || smoke.writingCategories.length !== 3) throw new Error('Preflight smoke failed; extended run was not started');
    }
    if (!config.smoke) await session('garden', 1, 'cancellation');
    do {
      for (const id of config.fixtures) {
        if (stopped() || Date.now() >= batchDeadline) break;
        await session(id, config.cycles, 'quality');
      }
    } while (config.durationMs && !stopped() && Date.now() < batchDeadline);
    report.finishReason = stopped() ? 'user_stop' : config.durationMs ? 'duration_limit' : 'sequence_complete';
    const totals = aggregate(report.sessions);
    report.state = stopped() ? 'stopped' : totals.fullyCompletedSessions !== totals.qualitySessions || totals.writingCategories.length !== 3 || totals.withinSessionDuplicatePairs || totals.invalidSkips ? 'completed_with_failures' : 'passed';
  } catch (error) {
    report.state = 'failed'; report.error = error.message;
  } finally {
    if (active) {
      stop(active.id);
      const deadline = Date.now() + 5000;
      while (!terminal(status(active.id)) && Date.now() < deadline) await sleep(100);
      if (terminal(status(active.id))) { report.sessions.push(summarize(read(runFile(active.id, 'report.json')), 'cleanup')); delete report.activeRunId; }
      else report.cleanup = 'unconfirmed';
    }
    clearInterval(heartbeat); report.finishedAt = now(); persist();
    fs.writeFileSync(path.join(dir, 'report.md'), `# Contextual batch\n\nState: **${report.state}**\n\n${report.interpretation}\n\nAggregate:\n\n\`\`\`json\n${JSON.stringify(report.aggregate, null, 2)}\n\`\`\`\n\n` + report.sessions.map(s => `- ${s.fixtureId} (${s.kind}): ${s.state}; ${s.completedCycles}/${s.requestedCycles} cycles; ${s.validSkipCount} skips; ${s.category || 'no failure'} — [session](${path.relative(dir, s.markdownPath).replaceAll('\\', '/')})`).join('\n'));
  }
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === script) {
  const [command = 'status', id] = process.argv.slice(2);
  fs.mkdirSync(base, { recursive: true });
  if (command === 'worker') await runBatch(directory(id), read(path.join(directory(id), 'config.json')));
  else if (command === 'start' || command === 'smoke' || command === 'hour') {
    const smoke = command === 'smoke';
    const config = { fixtureVersion, brain: brainConfig(), smoke, fixtures: smoke ? ['garden'] : fixtureIds, cycles: smoke ? 1 : 2, sessionDurationMs: 240000 };
    if (command === 'hour') { config.durationMs = 3600000; config.preflightSmoke = true; }
    if (!smoke && command !== 'hour') {
      const previous = read(path.join(base, 'smoke.json'));
      const evidence = read(path.join(directory(previous.id), 'report.json'));
      if (evidence.state !== 'passed' || Date.now() - Date.parse(evidence.finishedAt) > 3600000 || JSON.stringify(evidence.config.brain) !== JSON.stringify(config.brain) || evidence.config.fixtureVersion !== fixtureVersion) throw new Error('Run a passing same-model smoke within the last hour first');
    }
    // Avoid overlapping batch launchers, including between independent sessions.
    const lock = path.join(base, 'lease.json');
    if (fs.existsSync(lock)) {
      const old = read(lock);
      const prior = path.join(directory(old.id), 'report.json');
      if (!fs.existsSync(prior) || !read(prior).finishedAt) throw new Error('Previous batch has no final report; inspect its PID before recovery');
      fs.unlinkSync(lock);
    }
    const batchId = randomUUID(), dir = directory(batchId);
    fs.writeFileSync(lock, JSON.stringify({ id: batchId }), { flag: 'wx' });
    fs.mkdirSync(dir); save(path.join(dir, 'config.json'), config);
    const child = spawn(process.execPath, [script, 'worker', batchId], { cwd: root, detached: true, windowsHide: true, stdio: 'ignore' });
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    child.unref();
    const launch = { id: batchId, pid: child.pid, startedAt: now(), reportPath: path.join(dir, 'report.json') };
    save(path.join(dir, 'launch.json'), launch); save(path.join(base, smoke ? 'smoke.json' : 'latest.json'), launch);
    console.log(JSON.stringify(launch));
  } else if (command === 'stop' || command === 'status') {
    const batchId = id || read(path.join(base, 'latest.json')).id;
    if (command === 'stop') { save(path.join(directory(batchId), 'stop.json'), { requestedAt: now() }); console.log(JSON.stringify({ id: batchId, stopRequested: true })); }
    else { const report = read(path.join(directory(batchId), 'report.json')); console.log(JSON.stringify({ id: report.id, state: report.state, pid: report.pid, heartbeatAt: report.heartbeatAt, finishedAt: report.finishedAt, activeRunId: report.activeRunId, aggregate: report.aggregate, error: report.error })); }
  } else throw new Error('Use smoke, start, hour, status [id], or stop [id]');
}
