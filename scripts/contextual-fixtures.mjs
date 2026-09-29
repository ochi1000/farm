import { createFixture } from './simulation-persona.mjs';

// Versioned, synthetic-only inputs. Callers select a preset, never account content.
export const fixtureVersion = 1;
const scenarios = {
  garden: ['automation', 'A garden controller samples moisture every ten minutes and waters for twenty seconds. A manual switch is available. Disconnected probes are not detected.', 'How could we test a disconnected probe without watering the plants?'],
  notes: ['local_ai', 'An offline note sorter labels projects, reminders and reference notes. Users can correct labels. Confidence is displayed, but low-confidence notes are not queued for review.', 'How should a small manually labeled comparison set be selected?'],
  android: ['android', 'An Android lab dashboard samples battery level every five minutes. It retains the last reading while a device is offline and displays its timestamp. There is no stale-reading badge yet.', 'How could we verify that an offline reading is distinguishable from a fresh one?'],
  repair: ['diy', 'A repairable desk lamp uses a replaceable USB power module and screw-fastened panels. The prototype has a paper wiring diagram but no labels on its two similar connectors.', 'What simple check would make reassembly less error-prone?'],
  science: ['science', 'A classroom temperature logger records once a minute. Two sensors sit side by side and their readings are saved separately. The enclosure is shaded but not ventilated.', 'How could students compare the sensors using the saved readings?'],
  thread: ['automation', 'A workshop fan controller averages three dust-sensor readings before switching. Manual override lasts five minutes. Restarting clears the override and the saved average.', 'How could we check the restart behavior without producing dust?'],
  excluded: ['gambling', 'A synthetic gambling promotion with no eligible technology discussion.', 'An off-topic promotional reply.'],
  empty: null
};
export const fixtureIds = Object.keys(scenarios);
export function contextualFixture(id = 'default') {
  if (id === 'default') return createFixture();
  if (!Object.hasOwn(scenarios, id)) throw new Error('Unknown contextual fixture');
  const fixture = { posts: [], comments: [], timeline: [], viewed: 0, seen: [], post: null };
  const source = scenarios[id];
  if (!source) return fixture;
  const [topic, text, question] = source;
  fixture.posts.push({ id: 'post-1', topic, topics: [topic], text, liked: false });
  fixture.comments.push({ id: 'comment-1', parent: 'post-1', topics: [topic], text: question });
  fixture.comments.push({ id: 'comment-excluded', parent: 'post-1', topics: ['personal_attacks'], text: 'An argumentative synthetic comment.' });
  if (id === 'thread') fixture.comments.push({ id: 'thread-answer', parent: 'comment-1', topics: [topic], text: 'A fixed sensor input can isolate the restart behavior from changing dust levels.' });
  return fixture;
}
