import fs from 'node:fs';
import { brainConfig } from './contextual-brain.mjs';
import { reviewDraft, REVIEW_VERSION } from './contextual-review.mjs';
import { reviewerCases } from './reviewer-cases.mjs';
const config = brainConfig();
const report = { state: 'running', startedAt: new Date().toISOString(), model: config.model, reviewVersion: REVIEW_VERSION, cases: [], falseRejections: 0, falseAcceptances: 0, reviewerFailures: 0, liveSubmissions: 0 };
const save = () => fs.writeFileSync('results/contextual-review-eval.json', JSON.stringify(report, null, 2));
save();
try {
  const show = await fetch(new URL('/api/show', config.baseUrl), { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: config.model }) });
  if (!show.ok) throw new Error('Local model is unavailable');
  const info = await show.json(); if (info.remote_host || info.remote_model) throw new Error('Remote model is prohibited');
  for (const item of reviewerCases) {
    const events = []; const began = Date.now();
    let review, error;
    try {
      review = await reviewDraft({ context: item.context, emit: e => events.push(e), call: async body => {
        const response = await fetch(new URL('/api/chat', config.baseUrl), { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(config.timeoutMs), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, model: config.model, stream: false, think: false, options: { temperature: 0, num_ctx: 8192, num_predict: 800 } }) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        try { const data = await response.json(); if (!data.done || data.done_reason === 'length') throw new Error('Incomplete review'); return JSON.parse(data.message.content); }
        catch { throw Object.assign(new Error('Malformed model response'), { code: 'INVALID_RESPONSE' }); }
      } });
    } catch (e) { error = e.code || e.message; report.reviewerFailures++; }
    if (review?.verdict === 'reject' && item.expected === 'pass') report.falseRejections++;
    if (review?.verdict === 'pass' && item.expected === 'reject') report.falseAcceptances++;
    report.cases.push({ ...item, review, error, events, latencyMs: Date.now() - began }); save();
  }
  report.state = report.falseRejections || report.falseAcceptances || report.reviewerFailures ? 'failed' : 'passed';
} catch (error) { report.state = 'failed'; report.error = error.message; }
report.finishedAt = new Date().toISOString(); save();
console.log(JSON.stringify({ state: report.state, cases: report.cases.length, falseRejections: report.falseRejections, falseAcceptances: report.falseAcceptances, reviewerFailures: report.reviewerFailures, reportPath: 'results/contextual-review-eval.json' }));
if (report.state !== 'passed') process.exitCode = 1;
