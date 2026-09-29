import assert from 'node:assert/strict';
import test from 'node:test';
import { loadPersona, validatePersona, createFixture, decide, applyDecision } from './simulation-persona.mjs';

test('interests determine target selection; avoided topics override interest', () => {
  const persona = loadPersona(), fixture = createFixture();
  assert.equal(decide(persona, 'view_post', fixture, 1).targetId, 'post-1');
  persona.interests = { cooking: 10, automation: 1 };
  assert.equal(decide(persona, 'view_post', fixture, 1).targetId, 'post-3');
  fixture.posts = [fixture.posts[3]];
  assert.equal(decide(persona, 'view_post', fixture, 1).skip, true);
});
test('thresholds skip low-interest engagement', () => {
  const persona = loadPersona(), fixture = createFixture();
  fixture.post = fixture.posts[1];
  persona.minimumInterest.comment_post = 10;
  assert.equal(decide(persona, 'comment_post', fixture, 3).skip, true);
});
test('drafts reflect chosen topic, replies bind to a constructive parent', () => {
  const persona = loadPersona(), fixture = createFixture();
  applyDecision(fixture, decide(persona, 'view_post', fixture, 1), 1);
  const comment = decide(persona, 'comment_post', fixture, 3);
  assert.match(comment.text, /automation project/);
  assert.equal(applyDecision(fixture, comment, 3), true);
  const reply = decide(persona, 'reply_to_comment', fixture, 5);
  assert.equal(reply.targetId, 'comment-1');
  assert.equal(applyDecision(fixture, reply, 5), true);
  assert.equal(fixture.comments.find(c => c.id === 'persona-comment-5').parent, 'comment-1');
  assert.equal(decide(persona, 'reply_to_comment', fixture, 12).skip, true);
});
test('duplicate likes, comments and posts are skipped', () => {
  const persona = loadPersona(), fixture = createFixture();
  applyDecision(fixture, decide(persona, 'view_post', fixture, 1), 1);
  for (const [index, action] of ['like_post', 'comment_post', 'create_post'].entries()) {
    const decision = decide(persona, action, fixture, index + 2);
    assert.equal(applyDecision(fixture, decision, index + 2), true);
    assert.equal(decide(persona, action, fixture, index + 9).skip, true);
  }
});
test('persona validation rejects invalid weights and thresholds', () => {
  const persona = loadPersona();
  persona.interests.automation = 99;
  assert.throws(() => validatePersona(persona));
  persona.interests.automation = 10;
  persona.minimumInterest.like_post = -1;
  assert.throws(() => validatePersona(persona));
});
