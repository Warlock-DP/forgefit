import crypto from 'node:crypto';
import openrouter, { DEFAULT_MODEL, isFreeModel } from '../coach/adapters/openrouter.js';
import { build, canonicalPlan, DATA_CATEGORIES } from '../coach/payload.js';
import { buildPrompt, hashPlan, validateAnswer } from '../coach/protocol.js';
import { extractJSON } from '../coach/validate.js';
import { ApiError, emptyCore, requireUser, randomId, json, taskToken } from './security.js';
import { consentKey, hasConsent, revokeConsent, clearConsent } from './consent.js';

const defaults = () => ({ enabled: false, provider: 'openrouter', model: null,
  caps: { perProfileDaily: 5, instanceDaily: 20 }, auth: null, log: [] });
const record = () => ({ current: null, pending: null, history: [] });
const today = () => new Date().toISOString().slice(0, 10);
const quotaKey = () => 'coach-quota:' + today();
const configKey = 'netlify-coach-config';
const busyWindow = 12 * 60000;
const configView = value => ({ ...defaults(), ...value });
const historyEntry = (rec, entry) => { rec.history = [...(rec.history || []), entry].slice(-20); };

function encrypt(secret, key) {
  const nonce = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', crypto.createHash('sha256').update('openrouter:' + secret).digest(), nonce);
  const bytes = Buffer.concat([cipher.update(key, 'utf8'), cipher.final()]);
  return { nonce: nonce.toString('base64url'), bytes: bytes.toString('base64url'), tag: cipher.getAuthTag().toString('base64url') };
}
function decrypt(secret, auth) {
  if (!auth?.credential) return null;
  try {
    const data = auth.credential;
    const cipher = crypto.createDecipheriv('aes-256-gcm', crypto.createHash('sha256').update('openrouter:' + secret).digest(), Buffer.from(data.nonce, 'base64url'));
    cipher.setAuthTag(Buffer.from(data.tag, 'base64url'));
    return Buffer.concat([cipher.update(Buffer.from(data.bytes, 'base64url')), cipher.final()]).toString('utf8');
  } catch { return null; }
}
function expire(rec) {
  if (rec.current && Date.now() - rec.current.startedAt > busyWindow) {
    historyEntry(rec, { id: rec.current.id, kind: rec.current.kind, outcome: 'failed', errorClass: 'timeout', at: Date.now() });
    rec.current = null;
  }
  if (rec.pending?.expiresAt <= Date.now()) {
    historyEntry(rec, { id: rec.pending.id, kind: rec.pending.kind, outcome: 'expired', at: Date.now() }); rec.pending = null;
  }
  return rec;
}

export function createCoach({ store, cfg, fetchImpl = fetch, adapter = openrouter }) {
  const getConfig = async () => configView(await store.get(configKey));
  const keyFor = conf => decrypt(cfg.secret, conf.auth);
  const check = conf => {
    if (cfg.coachDisabled || !conf.enabled || !keyFor(conf)) throw new ApiError(503, 'the Coach is not set up on this instance', 'off');
  };
  const publicConfig = async () => {
    const conf = await getConfig();
    if (cfg.coachDisabled || !conf.enabled || !keyFor(conf)) return {};
    return { coach: { enabled: true, provider: 'openrouter', providerLabel: 'OpenRouter (free only)', contract: 1,
      scheduling: cfg.reminders, scheduledWindowMinutes: 15 } };
  };
  async function dispatch(task) {
    const response = await fetchImpl(cfg.origin + '/.netlify/functions/forgefit-worker-background', {
      method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: taskToken(cfg, task) }), signal: AbortSignal.timeout(10000)
    });
    if (response.status !== 202) throw new Error('background worker unavailable');
  }
  async function finish(uid, id, result) {
    return store.tx(['core', 'coach:' + uid, configKey, 'state:' + uid], async tx => {
      const rec = (await tx.get('coach:' + uid)) || record();
      // Forget/withdrawal/newer job must not be undone by a delayed function completion.
      if (rec.current?.id !== id) return false;
      const current = rec.current;
      const core = await tx.get('core') || emptyCore();
      const S = await tx.state(uid);
      if (!core.users.some(u => u.id === uid && !u.disabled) || !hasConsent(S, await tx.get(consentKey(uid)))) {
        await tx.remove('coach:' + uid); return false;
      }
      rec.current = null;
      if (result.pending !== undefined) rec.pending = result.pending;
      historyEntry(rec, { id, kind: current.kind, trigger: current.trigger, outcome: result.outcome,
        errorClass: result.errorClass || null, at: Date.now() });
      await tx.set('coach:' + uid, rec);
      const conf = configView(await tx.get(configKey));
      conf.log = [...(conf.log || []), { at: new Date().toISOString(), kind: current.kind, trigger: current.trigger,
        outcome: result.outcome, errorClass: result.errorClass || null, ms: Date.now() - current.startedAt }].slice(-100);
      await tx.set(configKey, conf);
      return true;
    });
  }
  async function enqueue(uid, opts, request) {
    const qKey = quotaKey();
    const job = await store.tx(['core', configKey, 'coach:' + uid, 'state:' + uid, qKey], async tx => {
      const core = await tx.get('core') || emptyCore();
      if (request) {
        if (requireUser(request, core, cfg).id !== uid) throw new ApiError(403, 'forbidden');
      } else if (!core.users.some(u => u.id === uid && !u.disabled)) throw new ApiError(403, 'account unavailable');
      const conf = configView(await tx.get(configKey)); check(conf);
      const S = await tx.state(uid);
      if (!hasConsent(S, await tx.get(consentKey(uid)))) throw new ApiError(403, 'the Coach needs your go-ahead first', 'consent');
      const rec = expire(await tx.get('coach:' + uid) || record());
      if (rec.current) throw new ApiError(409, 'the Coach is already thinking about your training', 'busy');
      if (opts.trigger === 'scheduled' && (rec.pending || rec.history.some(h => h.trigger === 'scheduled' && new Date(h.at).toISOString().slice(0, 10) === today()))) {
        throw new ApiError(409, 'automatic review already queued today', 'busy');
      }
      const quota = await tx.get(qKey) || { jobs: 0, requests: 0, perUser: {} };
      // Hard free-tier safety ceilings apply even if an admin raises their visible soft caps.
      const limit = Math.min(5, conf.caps.perProfileDaily || 5), instance = Math.min(20, conf.caps.instanceDaily || 20);
      if ((quota.perUser[uid] || 0) >= limit || quota.jobs >= instance || quota.requests >= 40) throw new ApiError(429, 'the Coach is resting — try again tomorrow', 'cap');
      quota.jobs++; quota.perUser[uid] = (quota.perUser[uid] || 0) + 1;
      await tx.set(qKey, quota);
      const job = { id: randomId(), kind: opts.kind, trigger: opts.trigger || 'manual', state: 'queued', startedAt: Date.now(),
        // Persist only job arguments. The current workout snapshot is read at execution.
        intake: opts.intake || null, note: opts.note || null, refine: opts.refine || null };
      rec.current = job; await tx.set('coach:' + uid, rec); return job;
    });
    try { await dispatch({ type: 'coach', uid, id: job.id }); }
    catch {
      await finish(uid, job.id, { outcome: 'failed', errorClass: 'internal' });
      throw new ApiError(503, 'the AI worker is temporarily unavailable; try again later');
    }
    return { id: job.id };
  }
  async function claim(uid, id) {
    return store.tx(['core', 'coach:' + uid, configKey, 'state:' + uid], async tx => {
      const rec = await tx.get('coach:' + uid);
      if (!rec?.current || rec.current.id !== id || rec.current.state !== 'queued') return null;
      const S = await tx.state(uid), core = await tx.get('core') || emptyCore(), conf = configView(await tx.get(configKey));
      if (!core.users.some(u => u.id === uid && !u.disabled) || !hasConsent(S, await tx.get(consentKey(uid))) || cfg.coachDisabled || !conf.enabled || !keyFor(conf)) {
        rec.current = null; await tx.set('coach:' + uid, rec); return null;
      }
      rec.current.state = 'running'; await tx.set('coach:' + uid, rec);
      return { job: rec.current, S, previous: rec.pending, conf };
    });
  }
  async function reserveRequest(uid, id, testRequest = false) {
    const qKey = quotaKey();
    return store.tx(['core', configKey, qKey, ...(testRequest ? [] : ['coach:' + uid, 'state:' + uid])], async tx => {
      const conf = configView(await tx.get(configKey));
      if (cfg.coachDisabled || !keyFor(conf)) return null;
      if (!testRequest) {
        const rec = await tx.get('coach:' + uid), S = await tx.state(uid), core = await tx.get('core') || emptyCore();
        if (!conf.enabled || rec?.current?.id !== id || !hasConsent(S, await tx.get(consentKey(uid))) || !core.users.some(u => u.id === uid && !u.disabled)) return null;
      }
      const quota = await tx.get(qKey) || { jobs: 0, requests: 0, perUser: {} };
      if (quota.requests >= 40) return null;
      quota.requests++; await tx.set(qKey, quota);
      return { conf, apiKey: keyFor(conf) };
    });
  }
  async function execute(uid, id) {
    const claimed = await claim(uid, id);
    if (!claimed) return; // Netlify retries and concurrent deliveries cannot duplicate inference.
    const { job, S, previous } = claimed;
    try {
      const payload = build(S, uid, { kind: job.kind, intake: job.intake, note: job.note, refine: job.refine,
        previous: previous?.bundle || null, secret: cfg.secret });
      let result, repair = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        const reserved = await reserveRequest(uid, id);
        if (!reserved) return finish(uid, id, { outcome: 'failed', errorClass: 'cap' });
        const response = await adapter.invoke({ prompt: buildPrompt(job.kind, payload, repair),
          env: { OPENROUTER_API_KEY: reserved.apiKey }, model: reserved.conf.model || DEFAULT_MODEL, timeoutMs: 300000 });
        result = validateAnswer(job.kind, payload, response);
        if (result.ok || !result.repairable || attempt === 1) break;
        repair = { previous: result.raw, errors: result.errors };
      }
      if (!result.ok) return finish(uid, id, { outcome: 'failed', errorClass: result.errorClass });
      if (result.nochange) return finish(uid, id, { outcome: 'nochange', pending: null });
      const pending = { id, kind: job.kind, createdAt: Date.now(), expiresAt: Date.now() + 14 * 86400000,
        planHash: hashPlan(canonicalPlan(S)), iteration: job.refine ? (previous?.iteration || 1) + 1 : 1, ...result.result };
      await finish(uid, id, { outcome: 'ready', pending });
    } catch { await finish(uid, id, { outcome: 'failed', errorClass: 'internal' }); }
  }
  async function testRun() {
    if (cfg.coachDisabled) return { ok: false, error: 'AI is disabled by the host configuration' };
    const reserved = await reserveRequest(null, null, true);
    if (!reserved) return { ok: false, error: 'Add an OpenRouter API key, or try again tomorrow if the request cap was reached' };
    const response = await adapter.invoke({ prompt: 'Reply with exactly this JSON object and nothing else: {"coach_contract":1,"ok":true}',
      env: { OPENROUTER_API_KEY: reserved.apiKey }, model: reserved.conf.model || DEFAULT_MODEL, timeoutMs: 35000 });
    const parsed = extractJSON(response.text);
    return response.code === 0 && parsed.value?.ok === true ? { ok: true, version: 'OpenRouter API (free only)' }
      : { ok: false, error: response.timedOut ? 'The free model did not answer in time' : response.stderr || 'The model did not return valid test JSON' };
  }
  async function route(key, body, request) {
    const core = await store.get('core') || emptyCore();
    const admin = key.includes('/api/admin/');
    const user = requireUser(request, core, cfg, admin);
    const conf = await getConfig();
    if (!admin && !['GET /api/coach/disclosure', 'POST /api/coach/forget'].includes(key)) check(conf);
    switch (key) {
      case 'GET /api/coach/disclosure': return json(200, { provider: 'openrouter', providerLabel: 'OpenRouter (free only)', categories: DATA_CATEGORIES, version: 1 });
      case 'GET /api/coach/status': {
        const rec = await store.tx(['coach:' + user.id], async tx => {
          const rec = expire(await tx.get('coach:' + user.id) || record()); await tx.set('coach:' + user.id, rec); return rec;
        });
        const quota = await store.get(quotaKey());
        return json(200, { job: rec.current ? { id: rec.current.id, kind: rec.current.kind, state: rec.current.state, startedAt: rec.current.startedAt } : null,
          pending: rec.pending, cap: { used: quota?.perUser?.[user.id] || 0, limit: Math.min(5, conf.caps.perProfileDaily || 5) } });
      }
      case 'POST /api/coach/plan':
        if (body.intake && (typeof body.intake !== 'object' || Array.isArray(body.intake) || JSON.stringify(body.intake).length > 12000)) throw new ApiError(400, 'intake is too large or invalid');
        return json(202, { job: await enqueue(user.id, { kind: 'create', intake: body.intake || null, refine: body.refine ? String(body.refine).slice(0, 1000) : null }, request) });
      case 'POST /api/coach/review': return json(202, { job: await enqueue(user.id, { kind: 'review', note: body.note ? String(body.note).slice(0, 1000) : null }, request) });
      case 'POST /api/coach/pending/resolve':
        await store.tx(['core', 'coach:' + user.id], async tx => {
          requireUser(request, await tx.get('core'), cfg);
          const rec = await tx.get('coach:' + user.id) || record();
          if (rec.pending) historyEntry(rec, { id: rec.pending.id, kind: rec.pending.kind, outcome: body.dismissed ? 'dismissed' : 'applied',
            accepted: Array.isArray(body.accepted) ? body.accepted.length : 0, rejected: Array.isArray(body.rejected) ? body.rejected.length : 0, at: Date.now() });
          rec.pending = null; await tx.set('coach:' + user.id, rec);
        }); return json(200, { ok: true });
      case 'POST /api/coach/forget':
        await store.tx(['core', 'coach:' + user.id, 'state:' + user.id], async tx => {
          requireUser(request, await tx.get('core'), cfg);
          await tx.remove('coach:' + user.id);
          const S = await tx.state(user.id);
          await revokeConsent(tx, user.id, S);
          if (S) { clearConsent(S); await tx.saveState(user.id, S); }
        }); return json(200, { ok: true });
      case 'GET /api/admin/coach': {
        const keyPresent = !!keyFor(conf), quota = await store.get(quotaKey());
        return json(200, { disabledByEnv: cfg.coachDisabled, enabled: !!conf.enabled, provider: 'openrouter',
          providers: [{ id: 'openrouter', label: 'OpenRouter (free only)', runtime: 'Netlify Functions + OpenRouter', apiKey: true, defaultModel: DEFAULT_MODEL, freeOnly: true }],
          model: conf.model, caps: conf.caps, hardCaps: { perProfileDaily: 5, instanceDaily: 20, requestsDaily: 40 },
          runtime: { ok: true, version: 'OpenRouter API (free only)' },
          auth: { state: keyPresent ? 'connected' : conf.auth ? 'unreadable' : 'disconnected', type: 'apikey', connectedAt: conf.auth?.connectedAt || null },
          jobsToday: quota?.jobs || 0, lastSuccess: conf.log.findLast(e => e.outcome !== 'failed') || null,
          lastError: conf.log.findLast(e => e.outcome === 'failed') || null, recent: conf.log.slice(-20).reverse() });
      }
      case 'POST /api/admin/coach/config':
        await store.tx(['core', configKey], async tx => {
          requireUser(request, await tx.get('core'), cfg, true);
          const conf = configView(await tx.get(configKey));
          if (body.provider !== undefined && body.provider !== 'openrouter') throw new ApiError(400, 'This Netlify deployment supports free-only OpenRouter');
          if (body.model !== undefined) {
            const model = String(body.model || '').trim();
            if (model && !isFreeModel(model)) throw new ApiError(400, 'Choose openrouter/free or an explicit :free model. Paid models are blocked.');
            conf.model = model || null;
          }
          if (body.enabled !== undefined) conf.enabled = !!body.enabled;
          if (body.caps) conf.caps = { perProfileDaily: Math.max(1, Math.min(5, +body.caps.perProfileDaily || 5)), instanceDaily: Math.max(1, Math.min(20, +body.caps.instanceDaily || 20)) };
          await tx.set(configKey, conf);
        }); return json(200, { ok: true });
      case 'POST /api/admin/coach/test': return json(200, await testRun());
      case 'POST /api/admin/coach/auth/key': {
        const apiKey = String(body.key || '').trim();
        if (apiKey.length < 16 || apiKey.length > 512 || /\s/.test(apiKey)) throw new ApiError(400, 'Enter a valid OpenRouter API key');
        await store.tx(['core', configKey], async tx => {
          requireUser(request, await tx.get('core'), cfg, true);
          const conf = configView(await tx.get(configKey));
          conf.auth = { type: 'apikey', connectedAt: new Date().toISOString(), credential: encrypt(cfg.secret, apiKey) };
          await tx.set(configKey, conf);
        }); return json(200, { ok: true, test: await testRun() });
      }
      case 'POST /api/admin/coach/auth/disconnect':
        await store.tx(['core', configKey], async tx => {
          requireUser(request, await tx.get('core'), cfg, true); const conf = configView(await tx.get(configKey));
          conf.auth = null; conf.enabled = false; await tx.set(configKey, conf);
        }); return json(200, { ok: true });
      default: return null;
    }
  }
  async function afterSync(uid, now = null) {
    const S = await store.state(uid), cadence = S?.coach?.cadence;
    if (!hasConsent(S, await store.get(consentKey(uid))) || !cadence || cadence === 'off') return;
    const last = S.coach.lastReview?.at || 0;
    const workouts = (S.workouts || []).filter(w => !last || (w.end || 0) > last || w.d > new Date(last).toISOString().slice(0, 10));
    if (!workouts.length) return;
    let due = cadence.everyWorkouts && workouts.length >= Math.max(1, Math.min(20, cadence.everyWorkouts));
    if (cadence.weekly && now && cfg.reminders) due = now.weekday === cadence.weekly.day && now.hhmm >= (cadence.weekly.time || '18:00') &&
      now.hhmm < addMinutes(cadence.weekly.time || '18:00', 30);
    if (due) await enqueue(uid, { kind: 'review', trigger: 'scheduled' });
  }
  return { route, publicConfig, enqueue, execute, afterSync, dispatch, finish };
}

function addMinutes(time, minutes) {
  const [h, m] = time.split(':').map(Number), total = h * 60 + m + minutes;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
