import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export function validatePersona(value) {
  if (!value || value.schemaVersion !== 1 || !/^[a-z0-9-]{1,60}$/.test(value.id) || !Number.isInteger(value.version) || value.version < 1) throw new Error('Invalid persona identity');
  for (const key of ['name', 'description', 'voice', 'commentTemplate', 'replyTemplate', 'postTemplate']) {
    if (typeof value[key] !== 'string' || !value[key].trim() || value[key].length > (key.endsWith('Template') ? 180 : 500)) throw new Error(`Invalid persona ${key}`);
  }
  if (!value.interests || typeof value.interests !== 'object' || Array.isArray(value.interests) || !Object.keys(value.interests).length || Object.keys(value.interests).length > 30) throw new Error('Invalid persona interests');
  for (const [topic, weight] of Object.entries(value.interests)) if (!/^[a-z_]{1,40}$/.test(topic) || !Number.isInteger(weight) || weight < 1 || weight > 10) throw new Error('Invalid interest weight');
  if (!Array.isArray(value.avoidTopics) || value.avoidTopics.length > 30 || value.avoidTopics.some(t => typeof t !== 'string' || !/^[a-z_]{1,40}$/.test(t))) throw new Error('Invalid avoided topics');
  for (const action of ['like_post', 'comment_post', 'reply_to_comment']) if (!Number.isInteger(value.minimumInterest?.[action]) || value.minimumInterest[action] < 1 || value.minimumInterest[action] > 10) throw new Error('Invalid interest threshold');
  return structuredClone(value);
}

export function loadPersona() {
  return validatePersona(JSON.parse(fs.readFileSync(fileURLToPath(new URL('../config/personas/practical-tech.json', import.meta.url)), 'utf8')));
}

export function createFixture() {
  return {
    posts: [
      { id: 'post-1', topic: 'automation', topics: ['automation', 'diy'], text: 'A simple sensor automates watering a small garden. It samples soil moisture every ten minutes and runs the pump for twenty seconds below a dry threshold. A manual switch is available, but disconnected-sensor detection is not implemented.', liked: false },
      { id: 'post-2', topic: 'local_ai', topics: ['local_ai'], text: 'A local model sorts notes without uploading them. The prototype labels notes as projects, reminders, or reference material. It shows a confidence score and lets the user correct labels. A comparison against manually labeled examples is planned.', liked: false },
      { id: 'post-3', topic: 'cooking', topics: ['cooking'], text: 'Trying a new bread recipe.', liked: false },
      { id: 'post-4', topic: 'automation', topics: ['automation', 'get_rich_quick'], text: 'An exaggerated get-rich automation pitch.', liked: false }
    ],
    comments: [
      { id: 'comment-1', parent: 'post-1', topics: ['automation'], text: 'How could we test this reliably?' },
      { id: 'comment-2', parent: 'post-1', topics: ['personal_attacks'], text: 'An argumentative fixture comment.' },
      { id: 'comment-3', parent: 'post-2', topics: ['local_ai'], text: 'Could a small test set help compare models?' }
    ],
    timeline: [], viewed: 0, seen: [], post: null
  };
}

function score(persona, item) {
  if (item.topics.some(topic => persona.avoidTopics.includes(topic))) return -1;
  return Math.max(0, ...item.topics.map(topic => persona.interests[topic] || 0));
}
const topicLabel = topic => topic.replaceAll('_', ' ');

export function decide(persona, action, fixture, step) {
  const skip = reason => ({ skip: true, reason, action });
  if (action === 'create_post') {
    const topic = Object.keys(persona.interests).filter(t => !persona.avoidTopics.includes(t)).sort((a, b) => persona.interests[b] - persona.interests[a] || a.localeCompare(b))[0];
    if (!topic) return skip('No eligible topic for a new post.');
    const text = persona.postTemplate.replaceAll('{topic}', topicLabel(topic));
    if (fixture.timeline.some(post => post.text === text)) return skip('This draft was already posted in this simulation.');
    return { action, text, targetId: `new-post-${step}`, reason: `Share a short thought about ${topicLabel(topic)}, the strongest eligible interest.` };
  }
  if (action === 'view_post' || action === 'scroll_feed') {
    const candidates = fixture.posts.filter(post => score(persona, post) > 0);
    candidates.sort((a, b) => Number(fixture.seen.includes(a.id)) - Number(fixture.seen.includes(b.id)) || score(persona, b) - score(persona, a) || a.id.localeCompare(b.id));
    if (!candidates.length) return skip('No posts match the persona interests.');
    const post = candidates[0];
    return { action, targetId: post.id, reason: `Choose ${topicLabel(post.topic)}: interest ${score(persona, post)}/10, ${fixture.seen.includes(post.id) ? 'previously seen' : 'not yet viewed'}.` };
  }
  const post = fixture.posts.find(p => p.id === fixture.post?.id);
  if (!post || score(persona, post) <= 0) return skip('No eligible viewed post.');
  if (score(persona, post) < (persona.minimumInterest[action] || 1)) return skip('Interest is below the engagement threshold.');
  if (action === 'like_post' && post.liked) return skip('This post is already liked.');
  if (action === 'comment_post' && fixture.comments.some(c => c.parent === post.id && c.byPersona)) return skip('Already commented on this post.');
  if (action === 'reply_to_comment') {
    const target = fixture.comments.filter(c => c.parent === post.id && !c.byPersona && score(persona, c) >= persona.minimumInterest.reply_to_comment && !fixture.comments.some(reply => reply.parent === c.id && reply.byPersona))
      .sort((a, b) => score(persona, b) - score(persona, a) || a.id.localeCompare(b.id))[0];
    if (!target) return skip('No relevant, unreplied-to constructive comment.');
    return { action, targetId: target.id, text: persona.replyTemplate.replaceAll('{topic}', topicLabel(post.topic)), reason: `Reply to a constructive ${topicLabel(post.topic)} comment; avoid arguments.` };
  }
  return { action, targetId: post.id, ...(action === 'comment_post' ? { text: persona.commentTemplate.replaceAll('{topic}', topicLabel(post.topic)) } : {}), reason: `${topicLabel(post.topic)} matches the persona; ${action === 'comment_post' ? 'ask a practical question' : 'engage with the viewed post'}.` };
}

export function applyDecision(fixture, decision, step) {
  const action = decision.action;
  if (action === 'view_post' || action === 'scroll_feed') {
    fixture.post = fixture.posts.find(p => p.id === decision.targetId);
    if (!fixture.post) return false;
    fixture.viewed++; if (!fixture.seen.includes(fixture.post.id)) fixture.seen.push(fixture.post.id);
    return true;
  }
  if (action === 'like_post') {
    const post = fixture.posts.find(p => p.id === decision.targetId);
    if (!post) return false;
    post.liked = true; return post.liked;
  }
  if (action === 'comment_post' || action === 'reply_to_comment') {
    const parentExists = action === 'comment_post' ? fixture.posts.some(p => p.id === decision.targetId) : fixture.comments.some(c => c.id === decision.targetId);
    if (!parentExists || !decision.text) return false;
    const id = `persona-comment-${step}`;
    fixture.comments.push({ id, parent: decision.targetId, text: decision.text, byPersona: true, topics: [] });
    return fixture.comments.some(c => c.id === id && c.parent === decision.targetId && c.text === decision.text);
  }
  if (action === 'create_post') {
    fixture.timeline.push({ id: decision.targetId, text: decision.text });
    return fixture.timeline.some(p => p.id === decision.targetId && p.text === decision.text);
  }
  return action === 'read_comments' && fixture.posts.some(p => p.id === decision.targetId);
}
