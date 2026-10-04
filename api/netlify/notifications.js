import webpush from 'web-push';
import { setTimeout as wait } from 'node:timers/promises';
import { ApiError, emptyCore, requireUser, randomId, json } from './security.js';
import { createCoach } from './coach.js';

export function userNow(tz, date = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(date);
    const get = t => parts.find(p => p.type === t)?.value;
    const iso = `${get('year')}-${get('month')}-${get('day')}`;
    return { date: iso, hhmm: `${get('hour')}:${get('minute')}`, weekday: new Date(iso + 'T12:00:00Z').getUTCDay() };
  } catch { return null; }
}
export function safeSubscription(sub) {
  if (typeof sub?.endpoint !== 'string' || sub.endpoint.length > 2048 || typeof sub.keys?.p256dh !== 'string' || typeof sub.keys?.auth !== 'string') return false;
  if (!/^[\w-]{80,100}$/.test(sub.keys.p256dh) || !/^[\w-]{20,30}$/.test(sub.keys.auth)) return false;
  try {
    const u = new URL(sub.endpoint);
    // An arbitrary endpoint would turn the server into a credential-bearing SSRF proxy.
    return u.protocol === 'https:' && !u.username && !u.password && !u.port && !u.hash &&
      (u.hostname === 'fcm.googleapis.com' || u.hostname === 'updates.push.services.mozilla.com' ||
       u.hostname.endsWith('.push.apple.com') || u.hostname.endsWith('.notify.windows.com'));
  } catch { return false; }
}
export function createNotifications({ store, cfg, fetchImpl = fetch, push = webpush, sleep = wait } = {}) {
  const coach = createCoach({ store, cfg, fetchImpl });
  async function vapid() {
    return store.tx(['netlify-vapid'], async tx => {
      let keys = await tx.get('netlify-vapid');
      if (!keys) { keys = push.generateVAPIDKeys(); await tx.set('netlify-vapid', keys); }
      return keys;
    });
  }
  async function send(uid, payload) {
    const core = await store.get('core') || emptyCore();
    if (!core.users.some(u => u.id === uid && !u.disabled)) return;
    const subs = core.subs.filter(s => s.userId === uid);
    if (!subs.length) return;
    const keys = await vapid();
    const invalid = [];
    await Promise.all(subs.map(async sub => {
      if (!safeSubscription(sub)) return;
      try {
        // Pass VAPID per request; do not mutate library-wide credential defaults.
        await push.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, JSON.stringify(payload), {
          urgency: 'high', TTL: 3600, timeout: 5000,
          vapidDetails: { subject: cfg.origin, publicKey: keys.publicKey, privateKey: keys.privateKey }
        });
      } catch (error) { if ([404, 410].includes(error.statusCode)) invalid.push(sub.endpoint); }
    }));
    if (invalid.length) await store.tx(['core'], async tx => {
      const current = await tx.get('core') || emptyCore();
      current.subs = current.subs.filter(s => s.userId !== uid || !invalid.includes(s.endpoint));
      await tx.set('core', current);
    });
  }
  async function rest(uid, id) {
    const task = await store.tx(['rest:' + uid], async tx => {
      const timer = await tx.get('rest:' + uid);
      if (timer?.id !== id || timer.started || timer.due < Date.now() - 60000) return null;
      timer.started = true; await tx.set('rest:' + uid, timer); return timer;
    });
    if (!task) return;
    await sleep(Math.max(0, task.due - Date.now()));
    // Cancelling/extending replaces the id, making a sleeping worker a harmless no-op.
    const due = await store.tx(['core', 'rest:' + uid], async tx => {
      const timer = await tx.get('rest:' + uid);
      const core = await tx.get('core') || emptyCore();
      if (timer?.id !== id || !core.users.some(u => u.id === uid && !u.disabled)) return false;
      await tx.remove('rest:' + uid); return true;
    });
    if (due) await send(uid, { title: 'Rest over 💪', body: 'Time for your next set.', tag: 'rest-timer' });
  }
  async function route(key, body, request) {
    if (key === 'GET /api/push/public-key') return json(200, { key: (await vapid()).publicKey });
    const user = requireUser(request, await store.get('core') || emptyCore(), cfg);
    switch (key) {
      case 'POST /api/push/subscribe':
        if (!safeSubscription(body.subscription)) throw new ApiError(400, 'invalid subscription or unsupported push service');
        await store.tx(['core'], async tx => {
          const core = await tx.get('core') || emptyCore(); requireUser(request, core, cfg);
          const sub = body.subscription;
          if (core.subs.some(s => s.endpoint === sub.endpoint && s.userId !== user.id)) throw new ApiError(409, 'subscription belongs to another profile');
          if (core.subs.filter(s => s.userId === user.id).length >= 10 && !core.subs.some(s => s.endpoint === sub.endpoint)) throw new ApiError(400, 'maximum of ten notification devices per profile');
          core.subs = core.subs.filter(s => s.endpoint !== sub.endpoint);
          core.subs.push({ userId: user.id, endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth }, created: new Date().toISOString() });
          await tx.set('core', core);
        }); return json(200, { ok: true });
      case 'POST /api/push/unsubscribe':
        await store.tx(['core', 'rest:' + user.id], async tx => {
          const core = await tx.get('core') || emptyCore(); requireUser(request, core, cfg);
          core.subs = core.subs.filter(s => s.userId !== user.id || s.endpoint !== body.endpoint);
          await tx.set('core', core); await tx.remove('rest:' + user.id);
        }); return json(200, { ok: true });
      case 'POST /api/push/test':
        await send(user.id, { title: 'ForgeFit', body: 'Test notification ✅ — this is what alerts look like.', tag: 'test' });
        return json(200, { ok: true });
      case 'POST /api/push/rest-timer': {
        const seconds = Math.round(+body.seconds || 0);
        if (seconds < 1 || seconds > 840) throw new ApiError(400, 'Cloud rest alerts support timers up to 14 minutes');
        const id = randomId();
        await store.tx(['core', 'rest:' + user.id], async tx => {
          requireUser(request, await tx.get('core'), cfg);
          await tx.set('rest:' + user.id, { id, due: Date.now() + seconds * 1000, started: false });
        });
        try { await coach.dispatch({ type: 'rest', uid: user.id, id }); }
        catch {
          await store.tx(['rest:' + user.id], async tx => {
            if ((await tx.get('rest:' + user.id))?.id === id) await tx.remove('rest:' + user.id);
          }); throw new ApiError(503, 'Background rest alert is unavailable; the on-screen timer still works');
        }
        return json(200, { ok: true });
      }
      case 'POST /api/push/rest-timer/cancel':
        await store.tx(['core', 'rest:' + user.id], async tx => {
          requireUser(request, await tx.get('core'), cfg); await tx.remove('rest:' + user.id);
        }); return json(200, { ok: true });
      default: return null;
    }
  }
  async function scheduled(now = new Date()) {
    if (!cfg.reminders) return; // No database wake-ups when notifications are disabled by the host.
    const core = await store.get('core') || emptyCore(), states = new Map((await store.states()).map(row => [row.userId, row.state]));
    // Bounded household scheduler. No scans of a global userbase, no infinite timers.
    await Promise.all(core.users.filter(u => !u.disabled).slice(0, 50).map(async user => {
      const S = states.get(user.id); if (!S) return;
      const local = userNow(S.reminder?.tz || 'UTC', now);
      await coach.afterSync(user.id, local).catch(() => {});
      if (!S.reminder?.on || !core.subs.some(s => s.userId === user.id)) return;
      // Allow a previous-day window for a reminder near midnight; claim once per local date.
      const candidate = [local, userNow(S.reminder?.tz || 'UTC', new Date(now.getTime() - 15 * 60000))]
        .find(c => c && c.hhmm >= S.reminder.time && minutesSince(c.hhmm, S.reminder.time) < 30);
      if (!candidate || (S.workouts || []).some(w => w.d === candidate.date)) return;
      const override = S.dayPlan?.[candidate.date];
      const rid = override === 'rest' ? null : override || S.week?.[candidate.weekday];
      const routine = S.routines?.find(r => r.id === rid); if (!routine) return;
      const claimed = await store.tx(['core'], async tx => {
        const current = await tx.get('core') || emptyCore(), u = current.users.find(u => u.id === user.id && !u.disabled);
        if (!u || u.lastReminder === candidate.date) return false;
        u.lastReminder = candidate.date; await tx.set('core', current); return true;
      });
      if (claimed) await send(user.id, { title: `${routine.emoji || '🏋️'} ${routine.name} today`, body: "It's on your plan — let's go 💪", tag: 'day-reminder' });
    }));
    await store.cleanup();
  }
  return { route, rest, send, scheduled };
}
function minutesSince(a, b) {
  const total = s => { const [h, m] = String(s).split(':').map(Number); return h * 60 + m; };
  return total(a) - total(b);
}
