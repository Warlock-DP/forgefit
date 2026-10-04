import test from 'node:test';
import assert from 'node:assert/strict';
import { createOpenRouterAdapter, DEFAULT_MODEL, isFreeModel } from '../coach/adapters/openrouter.js';

const KEY = 'fake-key-for-tests-only';
const json = (value, status = 200) => new Response(JSON.stringify(value), { status });
const catalog = (id = DEFAULT_MODEL, pricing = { prompt: '0', completion: '0' }) => json({ data: [{ id, pricing }] });
const completion = text => json({ choices: [{ finish_reason: 'stop', message: { content: text } }] });
const args = over => ({ env: { OPENROUTER_API_KEY: KEY }, prompt: 'Only test data, no workout history.', timeoutMs: 1000, ...over });

test('only the free router and explicit :free model IDs are accepted', () => {
  for (const id of ['openrouter/free', 'test/model:free', 'test-organization/model.v1:free']) assert.equal(isFreeModel(id), true, id);
  for (const id of ['openrouter/auto', 'test/model', 'test/model:free:online', 'test/model:free:nitro', 'test/model:free?search=true', '@preset', '~test/model:free', 'https://example.com/model:free', '', null]) {
    assert.equal(isFreeModel(id), false, String(id));
  }
});

test('missing credentials and paid models fail before any network access', async () => {
  const adapter = createOpenRouterAdapter(() => { throw new Error('network must not be called'); });
  assert.equal((await adapter.check({}, {})).ok, false);
  assert.equal((await adapter.check({ model: 'test/paid' }, args().env)).ok, false);
  assert.equal((await adapter.check({}, args().env)).ok, true);
  assert.match((await adapter.invoke(args({ env: {} }))).stderr, /key missing/);
  assert.match((await adapter.invoke(args({ model: 'openrouter/auto' }))).stderr, /blocked/);
});

test('verifies zero pricing, keeps the key off the public catalog, and requests JSON with no paid fallback', async () => {
  const calls = [];
  const adapter = createOpenRouterAdapter(async (url, options) => {
    calls.push({ url, options });
    return calls.length === 1 ? catalog() : completion(' {"coach_contract":1,"ok":true} ');
  });
  assert.deepEqual(await adapter.invoke(args()), { code: 0, text: '{"coach_contract":1,"ok":true}', stderr: '' });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, 'https://openrouter.ai/api/v1/models');
  assert.equal(calls[0].options.headers, undefined);
  assert.equal(calls[0].options.body, undefined);
  assert.equal(calls[1].url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(calls[1].options.headers.Authorization, 'Bearer ' + KEY);
  assert.equal(calls[1].options.redirect, 'error', 'never forward credentials to a redirected destination');
  const body = JSON.parse(calls[1].options.body);
  assert.equal(body.model, DEFAULT_MODEL);
  assert.equal(body.models, undefined, 'no list of alternative models');
  assert.deepEqual(body.plugins, []);
  assert.deepEqual(body.tools, []);
  assert.deepEqual(body.response_format, { type: 'json_object' });
  assert.deepEqual(body.provider, { allow_fallbacks: false, require_parameters: true, max_price: { prompt: 0, completion: 0, request: 0, image: 0 } });
  assert.equal(body.messages[1].content, args().prompt);
  assert.ok(!calls[1].options.body.includes(KEY));
});

test('a pinned free model uses the same price ceiling', async () => {
  const model = 'test/reviewed-model:free';
  let calls = 0;
  const adapter = createOpenRouterAdapter(async (_url, options) => {
    if (++calls === 1) return catalog(model, { prompt: 0, completion: 0, request: '0' });
    assert.equal(JSON.parse(options.body).model, model);
    return completion('{}');
  });
  assert.equal((await adapter.invoke(args({ model }))).code, 0);
});

test('unavailable or unverifiable pricing never sends a workout prompt or key', async () => {
  const cases = [
    json({ data: [] }),
    json({ data: [{ id: DEFAULT_MODEL }] }),
    catalog(DEFAULT_MODEL, {}),
    catalog(DEFAULT_MODEL, { prompt: '0', completion: '0.001' }),
    catalog(DEFAULT_MODEL, { prompt: '0', completion: '0', request: '1' }),
    catalog(DEFAULT_MODEL, { prompt: '0', completion: '0', image: null }),
    catalog(DEFAULT_MODEL, { prompt: '', completion: false }),
    json({}, 503),
    new Response('not valid JSON')
  ];
  for (const response of cases) {
    let calls = 0;
    const adapter = createOpenRouterAdapter(async (_url, options) => {
      calls++;
      assert.equal(options.headers, undefined);
      assert.equal(options.body, undefined);
      return response;
    });
    assert.equal((await adapter.invoke(args())).code, 1);
    assert.equal(calls, 1);
  }
});

test('quota, billing, and auth failures are redacted and never retried', async () => {
  for (const status of [400, 401, 402, 403, 404, 429, 503]) {
    let calls = 0;
    const adapter = createOpenRouterAdapter(async () => ++calls === 1 ? catalog() : json({ error: { message: KEY + ' private workout details' } }, status));
    const result = await adapter.invoke(args());
    assert.equal(result.code, 1);
    assert.equal(result.text, '');
    assert.ok(!result.stderr.includes(KEY));
    assert.ok(!result.stderr.includes('private workout'));
    assert.equal(calls, 2);
    if (status === 429) assert.match(result.stderr, /quota or provider capacity/);
    if (status === 402) assert.match(result.stderr, /No paid fallback/);
  }
});

test('invalid, interrupted, and embedded-error responses never become a plan', async () => {
  const cases = [
    json({ error: { code: 429, message: KEY } }),
    json({ choices: [{ finish_reason: 'length', message: { content: '{}' } }] }),
    json({ choices: [{ finish_reason: 'error', message: { content: '{}' } }] }),
    completion(''), json({ choices: [] }), new Response('not JSON')
  ];
  for (const response of cases) {
    let calls = 0;
    const adapter = createOpenRouterAdapter(async () => ++calls === 1 ? catalog() : response);
    const result = await adapter.invoke(args());
    assert.equal(result.code, 1);
    assert.equal(result.text, '');
    assert.ok(!result.stderr.includes(KEY));
    assert.equal(calls, 2);
  }
});

test('timeouts are classified while arbitrary exception text stays private', async () => {
  const timeout = createOpenRouterAdapter(async () => { throw new DOMException(KEY, 'TimeoutError'); });
  assert.equal((await timeout.invoke(args())).timedOut, true);
  const offline = createOpenRouterAdapter(async () => { throw new Error(KEY); });
  const result = await offline.invoke(args());
  assert.equal(result.code, 1);
  assert.ok(!result.stderr.includes(KEY));
});
