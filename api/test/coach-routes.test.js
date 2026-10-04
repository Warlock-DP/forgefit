import test from 'node:test';
import assert from 'node:assert/strict';
import { tempData } from './helpers.mjs';

tempData();
const cfg = await import('../coach/config.js');
const { coachRoutes } = await import('../coach/routes.js');

async function configure(body, authorized = true) {
  let result;
  const routes = coachRoutes({
    json: (_res, status, value) => { result = { status, value }; },
    readBody: async () => body,
    readSession: () => null,
    requireAdmin: () => authorized
  });
  await routes['POST /api/admin/coach/config']({}, {});
  return result;
}

test('choosing OpenRouter clears another provider model and credential', async () => {
  cfg.save({ provider: 'gemini', model: 'gemini-3.7-flash', auth: { type: 'apikey', data: cfg.encrypt({ token: 'fake-gemini-key' }) } });
  assert.equal((await configure({ provider: 'openrouter' })).status, 200);
  assert.equal(cfg.load().provider, 'openrouter');
  assert.equal(cfg.load().model, null);
  assert.equal(cfg.load().auth, null);
});

test('configuration rejects paid models without modifying saved settings', async () => {
  cfg.save({ provider: 'openrouter', model: null });
  const before = structuredClone(cfg.load());
  for (const model of ['openrouter/auto', 'test/paid', 'test/model:free:online']) {
    const result = await configure({ model, enabled: true });
    assert.equal(result.status, 400);
    assert.match(result.value.error, /free-only/);
    assert.deepEqual(cfg.load(), before);
  }
});

test('an explicit free model or blank default can be saved', async () => {
  assert.equal((await configure({ model: ' test/model:free ' })).status, 200);
  assert.equal(cfg.load().model, 'test/model:free');
  assert.equal((await configure({ model: '' })).status, 200);
  assert.equal(cfg.load().model, null);
});

test('a failed provider switch leaves the old provider and credential untouched', async () => {
  cfg.save({ provider: 'gemini', model: 'gemini-3.7-flash', auth: { type: 'apikey', data: cfg.encrypt({ token: 'fake-gemini-key' }) } });
  const before = structuredClone(cfg.load());
  assert.equal((await configure({ provider: 'openrouter', model: 'test/paid' })).status, 400);
  assert.deepEqual(cfg.load(), before);
});

test('only an administrator can change the provider', async () => {
  const before = structuredClone(cfg.load());
  assert.equal(await configure({ provider: 'openrouter' }, false), undefined);
  assert.deepEqual(cfg.load(), before);
});
