import assert from 'node:assert/strict';
import fs from 'node:fs';
import { reviewContext, validateReview, reviewDraft } from './contextual-review.mjs';
const pass = { verdict: 'pass', category: 'none', reason: 'Adds a different useful observation.', draftQuote: '', priorId: '', priorQuote: '', repeatedIdea: '' };
const context = { target: { text: 'A lamp has unlabeled connectors.', thread: [] }, draft: 'Label both connectors before taking the lamp apart.', recentInteractions: [{ text: 'Mark the connectors before disassembly.' }] };
const reject = { verdict: 'reject', category: 'repetition', reason: 'Both contributions advise marking connectors before disassembly.', draftQuote: context.draft, priorId: 'memory-1', priorQuote: context.recentInteractions[0].text, repeatedIdea: 'Mark connectors before disassembly to avoid reassembly errors.' };
const results = { state: 'running', cases: [] };
async function test(name, fn) { await fn(); results.cases.push(name); }
try {
  await test('Evidence IDs, exact quotes and verdict consistency', () => {
    const prepared = reviewContext(context);
    validateReview(pass, prepared); validateReview(reject, prepared);
    for (const value of [{ ...reject, priorId: 'invented' }, { ...reject, priorQuote: 'An invented passage.' }, { ...reject, draftQuote: 'Something not in the draft.' }, { ...reject, reason: 'The draft does not repeat earlier advice.' }, { ...pass, category: 'repetition' }, { ...pass, extra: true }]) assert.throws(() => validateReview(value, prepared), { code: 'INVALID_REVIEW' });
    assert.throws(() => validateReview({ ...pass, reason: 'The advice is semantically identical to the previous contribution.' }, prepared), { code: 'INVALID_REVIEW' });
  });
  await test('Invalid review retries once without changing draft or context', async () => {
    const bodies = [], events = [];
    const result = await reviewDraft({ context, emit: e => events.push(e), call: async body => { bodies.push(body); return bodies.length === 1 ? { ...reject, priorId: 'invented' } : pass; } });
    assert.equal(result.verdict, 'pass'); assert.equal(bodies.length, 2);
    assert.equal(bodies[0].messages[1].content, bodies[1].messages[1].content);
    assert.equal(events.filter(e => e.phase === 'review_invalid').length, 1);
  });
  await test('Two invalid reviews fail closed and never report acceptance', async () => {
    const events = []; let calls = 0;
    await assert.rejects(reviewDraft({ context, emit: e => events.push(e), call: async () => { calls++; return { ...reject, priorId: 'invented' }; } }), { code: 'INVALID_REVIEW' });
    assert.equal(calls, 2); assert.ok(!events.some(e => e.accepted));
  });
  await test('Valid rejection is final; transport failure is not retried', async () => {
    let calls = 0;
    assert.equal((await reviewDraft({ context, call: async () => { calls++; return reject; } })).verdict, 'reject');
    assert.equal(calls, 1);
    calls = 0;
    await assert.rejects(reviewDraft({ context, call: async () => { calls++; throw Object.assign(new Error('Unavailable'), { code: 'MODEL_HTTP' }); } }), { code: 'MODEL_HTTP' });
    assert.equal(calls, 1);
  });
  await test('Cancellation prevents invalid-review retry', async () => {
    const abort = new AbortController(); let calls = 0;
    await assert.rejects(reviewDraft({ context, signal: abort.signal, call: async () => { calls++; abort.abort(); return {}; } }), { name: 'AbortError' });
    assert.equal(calls, 1);
  });
  results.state = 'passed';
} catch (error) { results.state = 'failed'; results.error = error.stack; process.exitCode = 1; }
fs.writeFileSync('results/contextual-review-tests.json', JSON.stringify(results, null, 2));
console.log(JSON.stringify(results));
