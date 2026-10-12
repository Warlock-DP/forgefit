import test from 'node:test';
import assert from 'node:assert/strict';
import { stateRevision, revisionError } from '../state-revision.js';

test('content revisions are stable across JSONB object key ordering', () => {
  assert.equal(stateRevision({ workouts: [{ id: 'one', sets: [{ r: 8, w: 20 }] }], week: { 2: 'a', 1: 'b' } }),
    stateRevision({ week: { 1: 'b', 2: 'a' }, workouts: [{ sets: [{ w: 20, r: 8 }], id: 'one' }] }));
});
test('revisions detect history changes and array reordering', () => {
  assert.notEqual(stateRevision({ workouts: ['one', 'two'] }), stateRevision({ workouts: ['two', 'one'] }));
  assert.notEqual(stateRevision({ workouts: ['one'] }), stateRevision({ workouts: ['one', 'two'] }));
  assert.notEqual(stateRevision({}), stateRevision({ coach: { consent: null } }));
  assert.equal(stateRevision(null), null);
});
test('saves require the exact base revision, including an explicit null for a new profile', () => {
  assert.equal(revisionError({}, null).status, 428);
  assert.equal(revisionError({ baseRevision: null }, null), null);
  const state = { workouts: [] };
  assert.equal(revisionError({ baseRevision: null }, state).status, 409);
  assert.equal(revisionError({ baseRevision: stateRevision(state) }, state), null);
});
