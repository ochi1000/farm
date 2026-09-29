import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OllamaBrain, validatePlan } from './ollama.js';

const plan = { action: 'create_post', text: 'Automation test: local controller check.', username: '', postUrl: '', explanation: 'A labeled test.' };
test('brain rejects unknown fields, commands and unobserved targets', () => {
  assert.throws(() => validatePlan({ ...plan, approvalToken: 'not-allowed' }));
  assert.throws(() => validatePlan({ ...plan, action: 'shell' }));
  assert.throws(() => validatePlan({ ...plan, action: 'comment_post', postUrl: 'https://x.com/test/status/123' }));
  assert.throws(() => validatePlan({ ...plan, text: 'x'.repeat(281) }));
  assert.throws(() => new OllamaBrain({ baseUrl: 'https://example.com' }));
  assert.throws(() => new OllamaBrain({ model: 'some-model:cloud' }));
});
test('brain accepts observed pinned targets and never includes execution authority', async () => {
  const posts = [{ index: 0, liked: false, url: 'https://x.com/test/status/123', text: 'A garden photo.' }];
  assert.equal(validatePlan({ ...plan, action: 'comment_post', postUrl: posts[0].url }, posts).postUrl, posts[0].url);
  const brain = new OllamaBrain({ fetcher: (async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.stream, false);
    assert.equal(body.format.additionalProperties, false);
    assert.equal(init?.redirect, 'error');
    assert.ok(!JSON.stringify(body).includes('approvalToken'));
    return new Response(JSON.stringify({ done: true, message: { content: JSON.stringify(plan) } }));
  }) as typeof fetch });
  assert.deepEqual(await brain.plan('Make a test post'), plan);
});
test('brain rejects truncated and malformed responses', async () => {
  for (const data of [{ done: false }, { done: true, done_reason: 'length', message: { content: JSON.stringify(plan) } }, { done: true, message: { content: 'not json' } }]) {
    const brain = new OllamaBrain({ fetcher: (async () => new Response(JSON.stringify(data))) as typeof fetch });
    await assert.rejects(brain.plan('Make a test post'));
  }
});
