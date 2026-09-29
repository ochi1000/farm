import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { contextualFixture, fixtureIds } from './contextual-fixtures.mjs';
import { aggregate, summarize, runBatch } from './contextual-batch.mjs';
import { candidatesFor } from './contextual-brain.mjs';
import { loadPersona } from './simulation-persona.mjs';

const results = { state: 'running', cases: [], startedAt: new Date().toISOString() };
const server = http.createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw); res.setHeader('Content-Type', 'application/json');
  if (req.url === '/api/show') return res.end('{}');
  const context = JSON.parse(body.messages[1].content);
  const review = Boolean(body.format.properties.verdict);
  const target = context.candidates?.[0];
  const text = { comment_post: 'Could a disconnected probe leave the pump running between samples?', reply_to_comment: 'Disconnect the probe with the pump unplugged and observe the control output.', create_post: 'The manual switch provides a separate way to water while automatic readings are being checked.' }[context.action];
  const value = review ? { verdict: 'pass', category: 'none', reason: 'Synthetic test review.', draftQuote: '', priorId: '', priorQuote: '', repeatedIdea: '' } : { decision: 'engage', targetId: target.id, text, reason: 'Relevant fixture.', evidence: target.evidenceOptions[0] };
  // Leave enough time to deterministically exercise active HTTP cancellation.
  const timer = setTimeout(() => res.end(JSON.stringify({ done: true, message: { content: JSON.stringify(value) }, prompt_eval_count: 20, eval_count: 10 })), 150);
  res.on('close', () => clearTimeout(timer));
});
try {
  const persona = loadPersona();
  assert.equal(fixtureIds.length, 8);
  assert.throws(() => contextualFixture('../bad'));
  for (const id of fixtureIds) {
    const fixture = contextualFixture(id);
    const candidates = candidatesFor(persona, 'view_post', fixture, 1);
    assert.equal(candidates.length, ['empty', 'excluded'].includes(id) ? 0 : 1);
  }
  results.cases.push('Eight fixture eligibility boundaries');
  const failed = summarize({ id: 'synthetic-summary', fixtureId: 'garden', state: 'failed', completed: 2, total: 14, startedAt: '2026-01-01T00:00:00Z', finishedAt: '2026-01-01T00:00:01Z', errorCode: 'QUALITY_REJECTED', trace: [
    { type: 'plan_proposed', stepId: 3, proposal: { text: 'Rejected draft' } },
    { type: 'quality_review', stepId: 3, accepted: false, relevant: true, grounded: false, notRepeated: true, reason: 'Unsupported assertion' }
  ] });
  assert.equal(failed.category, 'review_rejection'); assert.equal(failed.rejectedDrafts.length, 1);
  assert.equal(aggregate([failed]).completedCycles, 0);
  assert.equal(aggregate([failed]).failureCategories.review_rejection, 1);
  const reviewerFailure = summarize({ id: 'synthetic-reviewer-failure', fixtureId: 'garden', state: 'failed', completed: 2, total: 14, startedAt: '2026-01-01T00:00:00Z', finishedAt: '2026-01-01T00:00:01Z', errorCode: 'INVALID_REVIEW', trace: [
    { type: 'plan_proposed', stepId: 3, proposal: { text: 'Unreviewed draft' } },
    { type: 'review_invalid', stepId: 3 }, { type: 'review_invalid', stepId: 3 }
  ] });
  assert.equal(reviewerFailure.category, 'reviewer_failure');
  assert.equal(reviewerFailure.rejectedDrafts.length, 0);
  assert.equal(aggregate([reviewerFailure]).invalidReviewAttempts, 2);
  results.cases.push('Failed partial cycle and rejected draft accounting');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const dir = path.resolve('results/contextual-batches', 'test-' + randomUUID());
  const report = await runBatch(dir, { smoke: false, fixtures: ['garden', 'excluded', 'empty'], cycles: 1, sessionDurationMs: 20000, brain: { baseUrl: `http://127.0.0.1:${server.address().port}`, model: 'fixture-local', timeoutMs: 2000 } });
  assert.equal(report.state, 'passed', report.error);
  assert.equal(report.sessions.length, 4);
  assert.equal(report.sessions[0].kind, 'cancellation');
  assert.equal(report.sessions[0].state, 'stopped');
  assert.equal(report.aggregate.validSkips, 14);
  assert.equal(report.aggregate.completedCycles, 3);
  assert.equal(report.aggregate.writingCategories.length, 3);
  assert.equal(report.aggregate.modelMetrics.requests, 6);
  assert.ok(fs.existsSync(path.join(dir, 'report.md')));
  assert.ok(report.sessions.every(s => fs.existsSync(s.reportPath)));
  results.cases.push('Process-level cancellation, varied sessions, skip and aggregate reports');
  results.batchReport = path.join(dir, 'report.json');
  const stoppedDir = path.resolve('results/contextual-batches', 'test-stop-' + randomUUID());
  fs.mkdirSync(stoppedDir, { recursive: true });
  const stopTimer = setInterval(() => {
    const file = path.join(stoppedDir, 'report.json');
    if (fs.existsSync(file) && JSON.parse(fs.readFileSync(file)).activeRunId) fs.writeFileSync(path.join(stoppedDir, 'stop.json'), '{}');
  }, 20);
  let stoppedReport;
  try { stoppedReport = await runBatch(stoppedDir, { smoke: true, fixtures: ['garden', 'android'], cycles: 1, sessionDurationMs: 20000, brain: { baseUrl: `http://127.0.0.1:${server.address().port}`, model: 'fixture-local', timeoutMs: 2000 } }); }
  finally { clearInterval(stopTimer); }
  assert.equal(stoppedReport.state, 'stopped');
  assert.equal(stoppedReport.sessions.length, 1);
  assert.equal(stoppedReport.sessions[0].laterSubmissions, 0);
  results.cases.push('Batch Stop cancels the owned session and prevents the next scenario');
  const timedDir = path.resolve('results/contextual-batches', 'test-timed-' + randomUUID());
  const timed = await runBatch(timedDir, { smoke: true, fixtures: ['empty'], cycles: 1, durationMs: 600, sessionDurationMs: 20000, brain: { baseUrl: `http://127.0.0.1:${server.address().port}`, model: 'fixture-local', timeoutMs: 2000 } });
  assert.equal(timed.finishReason, 'duration_limit');
  assert.ok(Date.parse(timed.finishedAt) >= Date.parse(timed.deadlineAt));
  assert.ok(Date.parse(timed.finishedAt) - Date.parse(timed.deadlineAt) < 3000);
  assert.equal(timed.sessions.length, 1);
  results.cases.push('Timed batch deadline cancels active work and writes final reports');
  results.state = 'passed';
} catch (error) { results.state = 'failed'; results.error = error.stack; process.exitCode = 1; }
finally { server.closeAllConnections(); server.close(); results.finishedAt = new Date().toISOString(); fs.writeFileSync('results/contextual-batch-tests.json', JSON.stringify(results, null, 2)); console.log(JSON.stringify(results)); }
