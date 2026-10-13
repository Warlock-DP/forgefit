import test from 'node:test';
import assert from 'node:assert/strict';
import { librarySlice, build } from '../coach/payload.js';
import { validateAnswer, buildPrompt } from '../coach/protocol.js';
const profile = { equipment: ['dumbbell', 'pull-up bar', 'push-up board'], dumbbellWeights: [4, 6, 10], daysPerWeek: 1 };
const payload = build({ coach: { profile }, routines: [], week: {} }, 'synthetic-user', { kind: 'chat', secret: 'test-only-secret', messages: [{ role: 'user', content: 'Plan my week' }] });
const answer = data => validateAnswer('chat', payload, { code: 0, text: JSON.stringify({ coach_contract: 1, ...data }) });
const plan = (id = '1760', weight = 6) => ({ routines: [{ id: 'r1', name: 'Home', ex: [{ id, sets: 3, reps: 10, weight }] }], week: { 1: 'r1' } });
test('home equipment never exposes bench/barbell/custom or unverified movements', () => {
  const home = librarySlice({ customEx: [{ id: 'custom', n: 'Bench press' }] }, profile.equipment);
  assert.ok(home.some(e => e.n === 'dumbbell goblet squat'));
  assert.ok(home.some(e => e.n === 'chin-up'));
  assert.ok(home.some(e => e.n === 'close-grip push-up'));
  assert.ok(home.every(e => Array.isArray(e.requirements)));
  assert.ok(home.every(e => !/bench|barbell|machine|incline/.test(e.n)));
  assert.ok(librarySlice({}, ['moon rocks']).every(e => e.requirements.length === 0));
  assert.ok(librarySlice({}, ['full gym']).length > home.length);
});
test('chat can ask a follow-up without creating or applying a plan', () => {
  const result = answer({ reply: 'How many days?', plan: null });
  assert.equal(result.ok, true); assert.equal(result.result, null);
  assert.ok(buildPrompt('chat', payload).includes('planning conversation'));
  assert.deepEqual(payload.coachProfile.dumbbellWeights, [4, 6, 10]);
});
test('chat accepts a compatible preview but rejects bench or invented exercises', () => {
  assert.equal(answer({ reply: 'Review this plan', plan: plan() }).ok, true);
  for (const id of ['0291', '0009', 'invented']) assert.equal(answer({ reply: 'Plan', plan: plan(id) }).ok, false);
});
test('chat rejects unavailable dumbbell loads, blank replies and malformed answers', () => {
  assert.equal(answer({ reply: 'Plan', plan: plan('1760', 12) }).ok, false);
  assert.equal(answer({ reply: '', plan: null }).ok, false);
  assert.equal(validateAnswer('chat', payload, { code: 0, text: 'hello' }).ok, false);
});
