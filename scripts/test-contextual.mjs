import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { start, stop, status, events, runFile, latest, history } from './simulation.mjs';
import { validateDecision, brainConfig, tooSimilar, candidatesFor } from './contextual-brain.mjs';
import { loadPersona, createFixture } from './simulation-persona.mjs';
const live = process.argv.includes('--live');
const reportPath = `results/contextual-${live ? 'live' : 'tests'}.json`;
if (process.argv.includes('--detach')) {
  const child = spawn(process.execPath, [process.argv[1], ...process.argv.slice(2).filter(a => a !== '--detach')], { detached: true, windowsHide: true, stdio: 'ignore' });
  child.unref(); console.log(JSON.stringify({ pid: child.pid, reportPath }));
} else {
  const report = { startedAt: new Date().toISOString(), state: 'running', cases: [], liveSubmissions: 0 };
  const save = () => fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  const terminal = s => ['completed', 'stopped', 'failed', 'interrupted'].includes(s.state) && Boolean(s.finishedAt);
  let current, server, mode = 'good', requests = [], closedRequests = 0;
  async function until(id, predicate, timeout = live ? 280000 : 10000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) { const s = status(id); if (predicate(s, events(id))) return s; await new Promise(r => setTimeout(r, 50)); }
    throw new Error('Test deadline exceeded');
  }
  async function test(name, fn) { await fn(); report.cases.push({ name, passed: true }); save(); }
  try {
    assert.ok(!latest() || terminal(latest()), 'Another simulation is running'); save();
    if (live) {
      current = start({ cycles: 1, stepMs: 10, waitMs: 10, durationMs: 270000, ...(process.argv.includes('--model') ? { brain: { model: process.argv[process.argv.indexOf('--model') + 1] } } : {}) });
      report.runId = current.id; save();
      const end = await until(current.id, terminal);
      report.outcome = end;
      report.writingActions = events(current.id).filter(e => e.type === 'draft_ready').map(e => e.action);
      assert.equal(end.state, 'completed', end.error); assert.equal(end.completed, 7);
      assert.deepEqual(new Set(report.writingActions), new Set(['comment_post', 'reply_to_comment', 'create_post']), 'Smoke must exercise all three writing actions');
      report.cases.push({ name: 'Installed Ollama contextual cycle', passed: true });
    } else {
      await test('Strict target, evidence, repetition and local configuration checks', async () => {
        assert.throws(() => brainConfig({ baseUrl: 'https://example.com' }));
        assert.throws(() => brainConfig({ model: 'qwen-cloud' }));
        const fixture = createFixture(), persona = loadPersona();
        const candidates = candidatesFor(persona, 'view_post', fixture, 1);
        assert.ok(!candidates.some(c => c.id === 'post-4'));
        const value = { decision: 'engage', targetId: candidates[0].id, text: '', reason: 'Relevant automation', evidence: candidates[0].text.slice(0, 140) };
        const context = { action: 'view_post', candidates, memory: [] };
        validateDecision(value, context);
        assert.throws(() => validateDecision({ ...value, targetId: 'unknown' }, context));
        assert.throws(() => validateDecision({ ...value, evidence: 'invented source detail' }, context));
        assert.throws(() => validateDecision({ ...value, unexpected: true }, context));
        assert.ok(tooSimilar('Test sensor reliability first.', 'Test sensor reliability first!'));
        assert.throws(() => validateDecision({ ...value, text: 'Test sensor reliability first.' }, { ...context, action: 'comment_post', memory: [{ text: 'Test sensor reliability first!' }] }));
      });
      server = http.createServer(async (req, res) => {
        let raw = ''; for await (const chunk of req) raw += chunk;
        const body = JSON.parse(raw); res.setHeader('Content-Type', 'application/json');
        if (req.url === '/api/show') { res.end(JSON.stringify(mode === 'cloud' ? { remote_host: 'cloud' } : {})); return; }
        requests.push(body);
        if (mode === 'hang') { res.on('close', () => { closedRequests++; }); return; }
        if (mode === 'http') { res.writeHead(503); res.end('{}'); return; }
        if (mode === 'skip') { res.end(JSON.stringify({ done: true, message: { content: JSON.stringify({ decision: 'skip', targetId: '', text: '', evidence: '', reason: 'No useful contribution.' }) } })); return; }
        if (mode === 'malformed') { res.end('broken'); return; }
        const review = !!body.format.properties?.verdict;
        const context = JSON.parse(body.messages[1].content);
        if (review && mode === 'retry-hang' && body.messages.length > 2) { res.on('close', () => { closedRequests++; }); return; }
        let value;
        if (review) value = { verdict: mode === 'reject' ? 'reject' : 'pass', category: mode === 'reject' ? 'relevance' : 'none', reason: 'Fixture review', draftQuote: mode === 'reject' ? context.draft : '', priorId: '', priorQuote: '', repeatedIdea: '' };
        else {
          const target = context.candidates.find(c => !c.seen) || context.candidates[0];
          const text = { comment_post: 'Could the garden sensor distinguish dry soil from a disconnected probe?', reply_to_comment: 'Try comparing watering decisions against a manually checked soil sample.', create_post: 'Garden watering automation raises a useful design question: what should happen when a sensor stops reporting?' }[context.action] || '';
          value = { decision: 'engage', targetId: mode === 'target' ? 'unknown' : target.id, text, reason: 'Practical automation matches the persona.', evidence: target.text.slice(0, 140) };
        }
        if (review && (mode === 'invalid-review' || (['retry-good', 'retry-hang'].includes(mode) && body.messages.length === 2))) value = { ...value, category: 'repetition' };
        res.end(JSON.stringify({ done: true, message: { content: JSON.stringify(value) }, prompt_eval_count: 20, eval_count: 10 }));
      });
      await new Promise(r => server.listen(0, '127.0.0.1', r));
      const brain = { baseUrl: `http://127.0.0.1:${server.address().port}`, model: 'fixture-local', timeoutMs: 2000 };
      const launch = (extra = {}) => current = start({ cycles: 1, stepMs: 10, waitMs: 0, brain, ...extra });
      await test('Full contextual cycle, memory, reviews and durable session report', async () => {
        const s = launch(); const end = await until(s.id, terminal); assert.equal(end.state, 'completed', end.error); assert.equal(end.completed, 7);
        assert.equal(end.modelMetrics.requests, 6);
        assert.equal(events(s.id).filter(e => e.type === 'quality_review').length, 3);
        assert.ok(requests.every(r => !JSON.stringify(r).includes('commentTemplate')));
        assert.ok(requests.some(r => JSON.parse(r.messages[1].content).recentInteractions.length > 0));
        const saved = JSON.parse(fs.readFileSync(runFile(s.id, 'report.json'))); assert.ok(saved.trace.some(e => e.text));
        assert.ok(history().some(r => r.id === s.id));
      });
      await test('Unexpected model skip stops the scheduled writing action', async () => {
        mode = 'skip'; const s = launch(); const end = await until(s.id, terminal); assert.equal(end.state, 'failed'); assert.equal(end.errorCode, 'INVALID_PLAN'); assert.ok(!events(s.id).some(e => e.type === 'submission_started' && e.stepId === 3));
      });
      await test('Invalid reviewer retry preserves draft and appears in reports', async () => {
        mode = 'retry-good'; const s = launch(); const end = await until(s.id, terminal);
        assert.equal(end.state, 'completed', end.error); assert.equal(end.modelMetrics.requests, 9);
        const journal = events(s.id);
        assert.equal(journal.filter(e => e.type === 'review_invalid').length, 3);
        assert.equal(journal.filter(e => e.type === 'plan_proposed').length, 3);
      });
      await test('Repeated invalid review stops without submission', async () => {
        mode = 'invalid-review'; const s = launch(); const end = await until(s.id, terminal);
        assert.equal(end.errorCode, 'INVALID_REVIEW');
        assert.equal(events(s.id).filter(e => e.type === 'review_invalid').length, 2);
        assert.ok(!events(s.id).some(e => e.type === 'submission_started' && e.stepId === 3));
      });
      await test('Stop closes active retry HTTP request', async () => {
        mode = 'retry-hang'; const closedBefore = closedRequests; const s = launch({ brain: { ...brain, timeoutMs: 60000 } });
        await until(s.id, (_, e) => e.filter(v => v.type === 'model_request' && v.purpose === 'review').length === 2);
        await new Promise(r => setTimeout(r, 50)); stop(s.id);
        const end = await until(s.id, terminal); assert.equal(end.state, 'stopped');
        assert.ok(closedRequests > closedBefore); assert.ok(!events(s.id).some(e => e.type === 'submission_started' && e.stepId === 3));
      });
      for (const [failure, code] of [['http', 'MODEL_HTTP'], ['malformed', 'INVALID_RESPONSE'], ['target', 'INVALID_TARGET'], ['reject', 'QUALITY_REJECTED'], ['cloud', 'LOCAL_ONLY']]) await test(`${failure} stops without publishing the rejected action`, async () => {
        mode = failure; const s = launch(); const end = await until(s.id, terminal); assert.equal(end.state, 'failed'); assert.equal(end.errorCode, code);
        const journal = events(s.id); assert.ok(!journal.some(e => e.type === 'submission_started' && e.stepId === end.currentStep));
        assert.equal(JSON.parse(fs.readFileSync(runFile(s.id, 'report.json'))).state, 'failed');
      });
      await test('Stop cancels in-flight HTTP inference with no submission', async () => {
        mode = 'hang'; const closedBefore = closedRequests; const s = launch({ brain: { ...brain, timeoutMs: 60000 } });
        await until(s.id, (_, e) => e.some(v => v.type === 'model_request')); stop(s.id);
        const end = await until(s.id, terminal); assert.equal(end.state, 'stopped'); assert.ok(end.stopLatencyMs < 2000);
        assert.ok(!events(s.id).some(e => e.type === 'submission_started' && e.stepId >= end.currentStep));
        assert.ok(closedRequests > closedBefore, 'Cancelled model HTTP connection must close');
      });
      await test('Model timeout produces a failed report', async () => {
        mode = 'hang'; const s = launch({ brain: { ...brain, timeoutMs: 150 } }); const end = await until(s.id, terminal);
        assert.equal(end.errorCode, 'MODEL_TIMEOUT'); assert.equal(end.state, 'failed');
      });
    }
    report.state = 'passed';
  } catch (error) { report.state = 'failed'; report.error = error.message; if (current && !terminal(status(current.id))) { stop(current.id); await until(current.id, terminal).catch(() => {}); } process.exitCode = 1; }
  finally { server?.closeAllConnections(); server?.close(); report.finishedAt = new Date().toISOString(); save(); console.log(JSON.stringify({ state: report.state, cases: report.cases.length, reportPath, error: report.error })); }
}
