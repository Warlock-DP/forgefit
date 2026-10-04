import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { createApi } from '../netlify/api.js';
import { createCoach } from '../netlify/coach.js';
import { createNotifications, safeSubscription, userNow } from '../netlify/notifications.js';
import { configuration, emptyCore, sessionCookie, taskToken, readTask, sign, fingerprint } from '../netlify/security.js';
import { buildPrompt, hashPlan } from '../coach/protocol.js';
import { canonicalPlan } from '../coach/payload.js';
import { consentKey } from '../netlify/consent.js';

// Test-only transactional shared database: clones values and rolls back rejected writes.
// Two createApi factories never share an account/challenge/job cache.
function memoryStore() {
  const data = new Map(), states = new Map(); let queue = Promise.resolve();
  const view = (data, states, changed = null) => ({
    async get(key) { return structuredClone(data.get(key) ?? null); },
    async set(key, value) { data.set(key, structuredClone(value)); changed?.data.add(key); },
    async remove(key) { data.delete(key); changed?.data.add(key); },
    async take(key) { const value = data.get(key); data.delete(key); changed?.data.add(key); return structuredClone(value ?? null); },
    async state(uid) { return structuredClone(states.get(uid) ?? null); },
    async saveState(uid, S) { states.set(uid, structuredClone(S)); changed?.states.add(uid); },
    async states() { return [...states].map(([userId, state]) => ({ userId, state: structuredClone(state) })); },
    async cleanup() {}
  });
  return { ...view(data, states), async tx(_keys, fn) {
    const result = queue.then(async () => {
      const d = structuredClone(data), s = structuredClone(states), changed = { data: new Set(), states: new Set() };
      const value = await fn(view(d, s, changed));
      for (const k of changed.data) { if (d.has(k)) data.set(k, d.get(k)); else data.delete(k); }
      for (const k of changed.states) { if (s.has(k)) states.set(k, s.get(k)); else states.delete(k); }
      return value;
    }); queue = result.catch(() => {}); return result;
  } };
}
const env = { DATABASE_URL: 'postgresql://test.invalid/forgefit', SESSION_SECRET: 'unit-test-secret-'.repeat(4),
  ORIGIN: 'https://forgefit-rutvik.netlify.app', OWNER_SETUP_CODE: 'A'.repeat(32), INVITE_ONLY: 'true' };
const cfg = configuration(env);
const webauthn = {
  async generateRegistrationOptions(opts) { return { challenge: 'reg-challenge', rp: { id: opts.rpID }, user: { id: opts.userID.toString('base64url') } }; },
  async verifyRegistrationResponse(opts) {
    assert.equal(opts.requireUserVerification, true); assert.equal(opts.expectedOrigin, env.ORIGIN);
    return { verified: true, registrationInfo: { credential: { id: opts.response.id, publicKey: Buffer.from('test-key'), counter: 0 } } };
  },
  async generateAuthenticationOptions(opts) { return { challenge: 'login-challenge', rpId: opts.rpID }; },
  async verifyAuthenticationResponse(opts) { assert.equal(opts.requireUserVerification, true); return { verified: true, authenticationInfo: { newCounter: opts.credential.counter + 1 } }; }
};
const dispatch = async () => new Response(null, { status: 202 });
function req(path, method = 'GET', body, user, overrides = {}) {
  return new Request(env.ORIGIN + path, { method, headers: { ...(method === 'GET' ? {} : { 'Content-Type': 'application/json', Origin: env.ORIGIN }),
    ...(user ? { Cookie: sessionCookie(user, cfg).split(';')[0] } : {}), ...overrides },
    ...(method === 'GET' ? {} : { body: JSON.stringify(body || {}) }) });
}
function app(store, extra = {}) { return createApi({ store, env, webauthn, fetchImpl: dispatch, ...extra }); }
async function seed(store) {
  const admin = { id: 'owner-profile-123456789', name: 'Owner', admin: true }, member = { id: 'other-profile-123456789', name: 'Member' };
  await store.set('core', { ...emptyCore(), users: [admin, member], creds: [{ id: 'login-key', userId: member.id, publicKey: 'dGVzdA', counter: 0 }] });
  await store.saveState(member.id, { routines: [], week: {}, workouts: [], coach: { consent: { agreedAt: new Date().toISOString(), version: 1 } } });
  return { admin, member };
}
async function connect(store, admin, adapter) {
  const coach = createCoach({ store, cfg, fetchImpl: dispatch, adapter });
  await coach.route('POST /api/admin/coach/auth/key', { key: 'fake-openrouter-test-key' }, req('/api/admin/coach/auth/key', 'POST', {}, admin));
  await coach.route('POST /api/admin/coach/config', { enabled: true }, req('/api/admin/coach/config', 'POST', {}, admin));
  return coach;
}
const testAdapter = { async invoke() { return { code: 0, text: '{"coach_contract":1,"ok":true}' }; } };

test('Netlify fails closed without private runtime configuration', async () => {
  const response = await createApi({ env: {}, store: memoryStore() })(req('/api/health'));
  assert.equal(response.status, 503);
});
test('health/config report Netlify + Neon without account counts or secrets', async () => {
  const store = memoryStore(); await seed(store);
  const response = await app(store)(req('/api/health'));
  assert.deepEqual(await response.json(), { ok: true, app: 'ForgeFit', hosting: 'netlify-functions', storage: 'neon', runtimeStorage: 'neon' });
  const conf = await (await app(store)(req('/api/config'))).json();
  assert.equal(conf.invite_only, true); assert.equal(conf.coach, undefined); assert.equal(JSON.stringify(conf).includes(env.SESSION_SECRET), false);
});
test('signup challenges survive cold starts and can only be consumed once', async () => {
  const store = memoryStore();
  const first = app(store), second = app(store);
  const options = await (await first(req('/api/register/options', 'POST', { name: 'Owner', code: env.OWNER_SETUP_CODE }))).json();
  const body = { cid: options.cid, credential: { id: 'first-key' } };
  const response = await second(req('/api/register/verify', 'POST', body));
  assert.equal(response.status, 200); const user = (await response.json()).user;
  assert.equal(user.admin, true);
  assert.match(response.headers.get('set-cookie'), /HttpOnly; Secure; SameSite=Lax/);
  assert.equal((await first(req('/api/register/verify', 'POST', body))).status, 400);
  assert.equal((await store.get('core')).users.length, 1);
});
test('owner setup code cannot create a second administrator', async () => {
  const store = memoryStore(); await seed(store);
  assert.equal((await app(store)(req('/api/register/options', 'POST', { name: 'Intruder', code: env.OWNER_SETUP_CODE }))).status, 403);
});
test('one invite cannot be redeemed by two parallel registrations', async () => {
  const store = memoryStore(); const core = emptyCore();
  core.users.push({ id: 'existing-owner', name: 'Owner', admin: true }); core.invites.push({ code: 'INVITE' }); await store.set('core', core);
  const options = await Promise.all(['One', 'Two'].map(async name => (await app(store)(req('/api/register/options', 'POST', { name, code: 'INVITE' }))).json()));
  const responses = await Promise.all(options.map((o, i) => app(store)(req('/api/register/verify', 'POST', { cid: o.cid, credential: { id: 'key-' + i } }))));
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 403]);
  assert.equal((await store.get('core')).users.length, 2);
});
test('expired and wrong-purpose challenges are refused', async () => {
  const store = memoryStore(); const cid = 'X'.repeat(22);
  await store.set('challenge:' + cid, { kind: 'register', exp: Date.now() - 1 });
  assert.equal((await app(store)(req('/api/register/verify', 'POST', { cid }))).status, 400);
  const options = await (await app(store)(req('/api/login/options', 'POST'))).json();
  assert.equal((await app(store)(req('/api/register/verify', 'POST', { cid: options.cid }))).status, 400);
});
test('login verifies canonical RP/origin and updates the credential in another instance', async () => {
  const store = memoryStore(); const { member } = await seed(store);
  const options = await (await app(store)(req('/api/login/options', 'POST'))).json();
  assert.equal(options.options.rpId, 'forgefit-rutvik.netlify.app');
  const response = await app(store)(req('/api/login/verify', 'POST', { cid: options.cid, credential: { id: 'login-key' } }));
  assert.equal(response.status, 200); assert.equal((await response.json()).user.id, member.id);
  assert.equal((await store.get('core')).creds[0].counter, 1);
});
test('invalid sessions, unauthenticated and non-admin requests are refused', async () => {
  const store = memoryStore(); const { member } = await seed(store);
  assert.equal((await app(store)(req('/api/data'))).status, 401);
  assert.equal((await app(store)(req('/api/admin/coach', 'GET', null, member))).status, 403);
  assert.equal((await app(store)(req('/api/me', 'GET', null, null, { Cookie: 'gymsid=bad' }))).status, 401);
  assert.equal((await app(store)(req('/api/me', 'GET', null, null, { Cookie: 'gymsid=' + sign(cfg.secret, member.id + ':NaN:0') }))).status, 401);
});
test('logout everywhere invalidates old cookies across instances', async () => {
  const store = memoryStore(); const { member } = await seed(store); const cookie = sessionCookie(member, cfg).split(';')[0];
  assert.equal((await app(store)(req('/api/logout/all', 'POST', {}, member))).status, 200);
  assert.equal((await app(store)(req('/api/me', 'GET', null, null, { Cookie: cookie }))).status, 401);
});
test('disabling and re-enabling an account does not resurrect its old session', async () => {
  const store = memoryStore(); const { member, admin } = await seed(store);
  for (const disabled of [true, false]) assert.equal((await app(store)(req('/api/admin/user/disable', 'POST', { id: member.id, disabled }, admin))).status, 200);
  assert.equal((await app(store)(req('/api/me', 'GET', null, member))).status, 401);
});
test('cloud state saves are per-user and in-progress workouts stay local', async () => {
  const store = memoryStore(); const { admin, member } = await seed(store);
  const state = { workouts: [{ d: '2026-10-01', name: 'Session' }], active: { name: 'In progress' }, _ts: 123 };
  assert.equal((await app(store)(req('/api/data', 'PUT', { state }, member))).status, 200);
  const saved = await (await app(store)(req('/api/data', 'GET', null, member))).json();
  assert.equal(saved.state.active, undefined); assert.equal(saved.state.workouts.length, 1);
  assert.equal((await (await app(store)(req('/api/data', 'GET', null, admin))).json()).state, null);
});
test('parallel metadata edits do not lose unrelated changes', async () => {
  const store = memoryStore(); const { admin } = await seed(store);
  const responses = await Promise.all(Array.from({ length: 10 }, (_, i) => app(store)(req('/api/admin/invites/new', 'POST', { note: 'Invitation ' + i }, admin))));
  assert.ok(responses.every(r => r.status === 200)); assert.equal((await store.get('core')).invites.length, 10);
});
test('cross-origin mutations, non-JSON bodies, malformed JSON and large bodies are rejected', async () => {
  const store = memoryStore();
  assert.equal((await app(store)(req('/api/login/options', 'POST', {}, null, { Origin: 'https://attacker.invalid' }))).status, 403);
  assert.equal((await app(store)(req('/api/login/options', 'POST', {}, null, { 'Content-Type': 'text/plain' }))).status, 415);
  assert.equal((await app(store)(new Request(env.ORIGIN + '/api/login/options', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' }))).status, 400);
  assert.equal((await app(store)(req('/api/login/options', 'POST', {}, null, { 'Content-Length': String(6 * 1024 * 1024) }))).status, 413);
});
test('authentication request quotas are durable across fresh handler instances', async () => {
  const store = memoryStore();
  for (let i = 0; i < 60; i++) assert.equal((await app(store)(req('/api/login/options', 'POST'), { ip: 'test-client' })).status, 200);
  assert.equal((await app(store)(req('/api/login/options', 'POST'), { ip: 'test-client' })).status, 429);
});
test('changed session secrets fail closed instead of silently losing credentials', async () => {
  const store = memoryStore(); await store.set('netlify-runtime', { secretHash: fingerprint('the-original-secret') });
  assert.equal((await app(store)(req('/api/health'))).status, 503);
});
test('AI key is encrypted; public/admin replies never return it', async () => {
  const store = memoryStore(); const { admin } = await seed(store); const coach = await connect(store, admin, testAdapter);
  const stored = await store.get('netlify-coach-config'); assert.equal(JSON.stringify(stored).includes('fake-openrouter-test-key'), false);
  const response = await coach.route('GET /api/admin/coach', {}, req('/api/admin/coach', 'GET', null, admin));
  const details = await response.text(); assert.equal(details.includes('fake-openrouter-test-key'), false); assert.equal(details.includes('credential'), false);
  assert.equal((await coach.publicConfig()).coach.provider, 'openrouter');
});

test('in-app OpenRouter settings remain owner-only for every mutation', async () => {
  const store = memoryStore(); const { member } = await seed(store);
  const paths = [
    ['/api/admin/coach/config', { enabled: true, model: 'openrouter/free' }],
    ['/api/admin/coach/auth/key', { key: 'test-key-not-a-real-credential' }],
    ['/api/admin/coach/auth/disconnect', {}],
    ['/api/admin/coach/test', {}]
  ];
  for (const [path, body] of paths) {
    assert.equal((await app(store)(req(path, 'POST', body))).status, 401);
    assert.equal((await app(store)(req(path, 'POST', body, member))).status, 403);
  }
  assert.equal(await store.get('netlify-coach-config'), null);
});

test('owner can save and test an encrypted OpenRouter key before enabling AI', async () => {
  const store = memoryStore(); const { admin } = await seed(store);
  let calls = 0;
  const coach = createCoach({ store, cfg, adapter: { async invoke({ prompt }) {
    calls++; assert.match(prompt, /coach_contract/); assert.equal(prompt.includes('workouts'), false);
    return { code: 0, text: '{"coach_contract":1,"ok":true}' };
  } } });
  const response = await coach.route('POST /api/admin/coach/auth/key', { key: 'synthetic-openrouter-key' }, req('/api/admin/coach/auth/key', 'POST', {}, admin));
  assert.deepEqual(await response.json(), { ok: true, test: { ok: true, version: 'OpenRouter API (free only)' } });
  assert.equal(calls, 1);
  const stored = await store.get('netlify-coach-config');
  assert.equal(stored.enabled, false);
  assert.equal(JSON.stringify(stored).includes('synthetic-openrouter-key'), false);
  assert.deepEqual(await coach.publicConfig(), {});
});
test('Netlify blocks paid providers/models and enforces free-tier hard ceilings', async () => {
  const store = memoryStore(); const { admin } = await seed(store); const coach = await connect(store, admin, testAdapter);
  for (const patch of [{ provider: 'gemini' }, { model: 'openrouter/auto' }, { model: 'openai/gpt-4' }]) {
    await assert.rejects(() => coach.route('POST /api/admin/coach/config', patch, req('/api/admin/coach/config', 'POST', {}, admin)), e => e.status === 400);
  }
  await coach.route('POST /api/admin/coach/config', { caps: { perProfileDaily: 200, instanceDaily: 5000 } }, req('/api/admin/coach/config', 'POST', {}, admin));
  assert.deepEqual((await store.get('netlify-coach-config')).caps, { perProfileDaily: 5, instanceDaily: 20 });
});
test('AI consent and single-flight are enforced in the database', async () => {
  const store = memoryStore(); const { admin, member } = await seed(store); const coach = await connect(store, admin, testAdapter);
  await store.saveState(member.id, { coach: {} });
  await assert.rejects(() => coach.enqueue(member.id, { kind: 'review' }), e => e.code === 'consent');
  await store.saveState(member.id, { coach: { consent: { agreedAt: new Date().toISOString(), version: 1 } } });
  const outcomes = await Promise.allSettled([coach.enqueue(member.id, { kind: 'review' }), createCoach({ store, cfg, fetchImpl: dispatch }).enqueue(member.id, { kind: 'review' })]);
  assert.equal(outcomes.filter(o => o.status === 'fulfilled').length, 1);
  assert.equal(outcomes.find(o => o.status === 'rejected').reason.code, 'busy');
});
test('two worker deliveries make only one AI request; results survive another instance', async () => {
  const store = memoryStore(); const { admin, member } = await seed(store); let calls = 0;
  const adapter = { async invoke({ prompt }) { calls++; assert.equal(prompt.includes(member.name), false);
    return { code: 0, text: '{"coach_contract":1,"nochange":true,"reading":"Your training is progressing."}' }; } };
  const coach = await connect(store, admin, testAdapter); const job = await coach.enqueue(member.id, { kind: 'review' });
  await Promise.all([createCoach({ store, cfg, adapter }).execute(member.id, job.id), createCoach({ store, cfg, adapter }).execute(member.id, job.id)]);
  assert.equal(calls, 1); const rec = await store.get('coach:' + member.id);
  assert.equal(rec.current, null); assert.equal(rec.history.at(-1).outcome, 'nochange');
});
test('withdrawing consent/forgetting prevents queued jobs from making an AI call', async () => {
  const store = memoryStore(); const { admin, member } = await seed(store); let calls = 0;
  const coach = await connect(store, admin, testAdapter), job = await coach.enqueue(member.id, { kind: 'review' });
  await coach.route('POST /api/coach/forget', {}, req('/api/coach/forget', 'POST', {}, member));
  await createCoach({ store, cfg, adapter: { async invoke() { calls++; } } }).execute(member.id, job.id);
  assert.equal(calls, 0); assert.equal(await store.get('coach:' + member.id), null);
  assert.equal((await store.state(member.id)).coach.consent, null);
});
test('only a valid acceptance of the current disclosure allows AI sharing', async () => {
  const store = memoryStore(); const { admin, member } = await seed(store); const coach = await connect(store, admin, testAdapter);
  for (const consent of [{ agreedAt: new Date().toISOString() }, { agreedAt: new Date().toISOString(), version: 0 },
    { agreedAt: 'not a date', version: 1 }, { agreedAt: new Date(Date.now() + 3600000).toISOString(), version: 1 }]) {
    await store.saveState(member.id, { coach: { consent } });
    await assert.rejects(() => coach.enqueue(member.id, { kind: 'review' }), e => e.code === 'consent');
  }
});
test('a stale device cannot restore withdrawn consent; a new explicit acceptance can', async () => {
  const store = memoryStore(); const { admin, member } = await seed(store); const coach = await connect(store, admin, testAdapter);
  const stale = await store.state(member.id);
  await coach.route('POST /api/coach/forget', {}, req('/api/coach/forget', 'POST', {}, member));
  assert.equal((await app(store)(req('/api/data', 'PUT', { state: stale }, member))).status, 200);
  assert.equal((await store.state(member.id)).coach.consent, null);
  await assert.rejects(() => coach.enqueue(member.id, { kind: 'review' }), e => e.code === 'consent');
  const fresh = await store.state(member.id);
  fresh.coach.consent = { agreedAt: new Date((await store.get(consentKey(member.id))) + 1).toISOString(), version: 1 };
  assert.equal((await app(store)(req('/api/data', 'PUT', { state: fresh }, member))).status, 200);
  assert.deepEqual((await store.state(member.id)).coach.consent, fresh.coach.consent);
  assert.ok((await coach.enqueue(member.id, { kind: 'review' })).id);
});
test('syncing a consent withdrawal also blocks older accepted snapshots', async () => {
  const store = memoryStore(); const { member } = await seed(store), stale = await store.state(member.id);
  const withdrawn = structuredClone(stale); withdrawn.coach.consent = null;
  assert.equal((await app(store)(req('/api/data', 'PUT', { state: withdrawn }, member))).status, 200);
  assert.equal((await app(store)(req('/api/data', 'PUT', { state: stale }, member))).status, 200);
  assert.equal((await store.state(member.id)).coach.consent, null);
});
test('late worker completions cannot restore a forgotten proposal', async () => {
  const store = memoryStore(); const { admin, member } = await seed(store);
  const coach = await connect(store, admin, testAdapter), job = await coach.enqueue(member.id, { kind: 'review' });
  await store.remove('coach:' + member.id);
  await coach.finish(member.id, job.id, { outcome: 'ready', pending: { id: job.id } });
  assert.equal(await store.get('coach:' + member.id), null);
});
test('request quotas include test calls and survive forgetting the Coach', async () => {
  const store = memoryStore(); const { admin, member } = await seed(store); const coach = await connect(store, admin, testAdapter);
  const key = 'coach-quota:' + new Date().toISOString().slice(0, 10);
  await store.set(key, { jobs: 5, requests: 40, perUser: { [member.id]: 5 } });
  await coach.route('POST /api/coach/forget', {}, req('/api/coach/forget', 'POST', {}, member));
  const response = await coach.route('POST /api/admin/coach/test', {}, req('/api/admin/coach/test', 'POST', {}, admin));
  assert.equal((await response.json()).ok, false); assert.equal((await store.get(key)).requests, 40);
});
test('background envelopes cannot be forged or replayed after expiration', () => {
  const token = taskToken(cfg, { type: 'coach', uid: 'u', id: 'j' });
  assert.equal(readTask(cfg, token).type, 'coach'); assert.equal(readTask(cfg, token + 'bad'), null);
  assert.equal(readTask(cfg, sign(cfg.secret, JSON.stringify({ expires: 1 }))), null);
});
test('notification subscriptions block localhost/arbitrary endpoints', () => {
  const sub = endpoint => ({ endpoint, keys: { p256dh: 'a'.repeat(87), auth: 'a'.repeat(22) } });
  assert.equal(safeSubscription(sub('https://fcm.googleapis.com/fcm/send/test')), true);
  for (const endpoint of ['http://fcm.googleapis.com/test', 'https://localhost/test', 'https://attacker.invalid/', 'https://fcm.googleapis.com.attacker.invalid/', 'https://user:password@fcm.googleapis.com/']) assert.equal(safeSubscription(sub(endpoint)), false);
});
test('rest timer cancellation/extension invalidates a sleeping worker', async () => {
  const store = memoryStore(); const { member } = await seed(store); let sent = 0;
  await store.set('rest:' + member.id, { id: 'old', due: Date.now() + 100, started: false });
  const notifications = createNotifications({ store, cfg, push: { generateVAPIDKeys() { throw new Error('should not send'); } },
    sleep: async () => { await store.set('rest:' + member.id, { id: 'new', due: Date.now() + 1000 }); sent++; } });
  await notifications.rest(member.id, 'old'); assert.equal(sent, 1); assert.equal((await store.get('rest:' + member.id)).id, 'new');
});
test('timezone helper handles midnight using 00 rather than 24', () => {
  assert.deepEqual(userNow('Asia/Kolkata', new Date('2026-10-03T18:30:00Z')), { date: '2026-10-04', hhmm: '00:00', weekday: 0 });
  assert.equal(userNow('invalid-zone'), null);
});
test('serverless prompt/hash contracts match the original app format', () => {
  const S = { routines: [{ id: 'r1', name: 'Day', ex: [{ id: 'x', sets: 3, reps: 8 }] }], week: { 1: 'r1' } };
  assert.match(hashPlan(canonicalPlan(S)), /^[0-9a-f]{16}$/);
  const payload = { coach_contract: 1, plan: canonicalPlan(S) };
  const expected = fs.readFileSync(new URL('../coach/prompts/common.md', import.meta.url), 'utf8') + '\n\n---\n\n' +
    fs.readFileSync(new URL('../coach/prompts/review.md', import.meta.url), 'utf8') + '\n\n---\n\n## Payload\n\n```json\n' + JSON.stringify(payload, null, 1) + '\n```\n';
  assert.equal(buildPrompt('review', payload), expected);
});
