import crypto from 'node:crypto';
import * as passkeys from '@simplewebauthn/server';
import { createNeonStore } from './store.js';
import { ApiError, configuration, emptyCore, fingerprint, requireUser, userShape,
  randomId, equal, mac, sessionCookie, protectRequest, readBody, json } from './security.js';
import { createCoach } from './coach.js';
import { createNotifications } from './notifications.js';
import { consentKey, hasConsent, revokeConsent, clearConsent } from './consent.js';
import { stateRevision, revisionError } from '../state-revision.js';

const nameOf = value => String(value || '').trim().slice(0, 40);
const codeOf = value => String(value || '').trim().toUpperCase();
const live = p => p && Date.now() - p.updatedAt <= 70000 ? p : null;
const initialInvite = (core, code, cfg) => !core.users.some(u => u.admin) && cfg.ownerCode.length >= 32 && equal(code, cfg.ownerCode);
const validInvite = (core, code) => core.invites.find(i => i.code === code && !i.usedBy && !i.revoked);

export function createApi({ env = process.env, store: injectedStore, webauthn = passkeys, fetchImpl = fetch } = {}) {
  // A factory is a test seam, not an account cache. Instances share only the database.
  return async function handle(request, context = {}) {
    try {
      const cfg = configuration(env);
      const url = new URL(request.url);
      protectRequest(request, cfg.origin);
      const store = injectedStore || createNeonStore(env.DATABASE_URL);
      const core = (await store.get('core')) || emptyCore();
      const runtime = await store.get('netlify-runtime');
      if (runtime && runtime.secretHash !== fingerprint(cfg.secret)) throw new ApiError(503, 'The session secret does not match the cloud account settings');
      const key = request.method + ' ' + url.pathname;
      const body = ['POST', 'PUT'].includes(request.method) ? await readBody(request) : {};
      const coach = createCoach({ store, cfg, fetchImpl });
      const notifications = createNotifications({ store, cfg, fetchImpl });
      const auth = (admin = false) => requireUser(request, core, cfg, admin);
      // Mutations re-check the caller under the same cross-instance lock as the change.
      const mutate = (admin, fn, extra = []) => store.tx(['core', ...extra], async tx => {
        const current = (await tx.get('core')) || emptyCore();
        const user = requireUser(request, current, cfg, admin);
        const result = await fn(current, user, tx);
        await tx.set('core', current);
        return result;
      });
      async function challenge(data) {
        const cid = randomId();
        await store.set('challenge:' + cid, { ...data, exp: Date.now() + 5 * 60000 });
        return cid;
      }
      async function takeChallenge(cid, kind) {
        if (typeof cid !== 'string' || !/^[\w-]{20,30}$/.test(cid)) throw new ApiError(400, 'challenge expired — try again');
        const c = await store.take('challenge:' + cid);
        if (!c || c.exp <= Date.now() || c.kind !== kind) throw new ApiError(400, 'challenge expired — try again');
        return c;
      }
      async function authRateLimit() {
        // The platform-supplied client address cannot be overridden by an HTTP header.
        const source = mac(cfg.secret, String(context.ip || 'unidentified'));
        const limitKey = 'rate:' + source;
        await store.tx([limitKey], async tx => {
          const old = await tx.get(limitKey);
          const rate = old?.exp > Date.now() ? old : { count: 0, exp: Date.now() + 10 * 60000 };
          if (rate.count >= 60) throw new ApiError(429, 'Too many sign-in attempts — try again shortly');
          rate.count++; await tx.set(limitKey, rate);
        });
      }

      switch (key) {
        case 'GET /api/health':
          return json(200, { ok: true, app: 'ForgeFit', hosting: 'netlify-functions', storage: 'neon', runtimeStorage: 'neon' });
        case 'GET /api/config':
          return json(200, { invite_only: cfg.inviteOnly, hosting: 'netlify-functions',
            notifications: { scheduled: cfg.reminders, reminderWindowMinutes: 15, maxRestSeconds: 840 },
            ...(await coach.publicConfig()) });
        case 'GET /api/me': return json(200, { user: userShape(auth(), cfg) });
        case 'POST /api/register/options': {
          await authRateLimit();
          const name = nameOf(body.name), code = codeOf(body.code);
          if (!name) throw new ApiError(400, 'name required');
          if (cfg.inviteOnly && !validInvite(core, code) && !initialInvite(core, code, cfg)) throw new ApiError(403, 'a valid invite code is required');
          const uid = randomId();
          const options = await webauthn.generateRegistrationOptions({
            rpName: cfg.rpName, rpID: cfg.rpId, userID: Buffer.from(uid), userName: name,
            userDisplayName: name, attestationType: 'none',
            authenticatorSelection: { residentKey: 'required', userVerification: 'required' }, excludeCredentials: []
          });
          return json(200, { cid: await challenge({ kind: 'register', challenge: options.challenge, uid, name, code }), options });
        }
        case 'POST /api/register/verify': {
          await authRateLimit();
          const c = await takeChallenge(body.cid, 'register');
          let verified;
          try { verified = await webauthn.verifyRegistrationResponse({ response: body.credential,
            expectedChallenge: c.challenge, expectedOrigin: cfg.origin, expectedRPID: cfg.rpId, requireUserVerification: true }); }
          catch { throw new ApiError(400, 'passkey verification failed — try again'); }
          if (!verified.verified || !verified.registrationInfo?.credential) throw new ApiError(400, 'not verified');
          const credential = verified.registrationInfo.credential;
          const user = await store.tx(['core', 'netlify-runtime'], async tx => {
            const current = (await tx.get('core')) || emptyCore();
            if (current.creds.some(x => x.id === credential.id)) throw new ApiError(409, 'credential already registered');
            const owner = initialInvite(current, c.code, cfg);
            const invite = validInvite(current, c.code);
            if (cfg.inviteOnly && !owner && !invite) throw new ApiError(403, 'invite code is no longer valid — ask for a new one');
            const state = await tx.get('netlify-runtime');
            if (state && state.secretHash !== fingerprint(cfg.secret)) throw new ApiError(503, 'The session secret does not match the cloud account settings');
            await tx.set('netlify-runtime', { secretHash: fingerprint(cfg.secret) });
            const user = { id: c.uid, name: c.name, created: new Date().toISOString(), ...(owner ? { admin: true } : {}) };
            if (invite) { user.invitedBy = invite.code; invite.usedBy = user.id; invite.usedAt = user.created; }
            current.users.push(user);
            current.creds.push({ id: credential.id, userId: user.id,
              publicKey: Buffer.from(credential.publicKey).toString('base64url'), counter: credential.counter || 0,
              transports: body.credential?.response?.transports || [] });
            await tx.set('core', current);
            return user;
          });
          return json(200, { user: userShape(user, cfg) }, { 'Set-Cookie': sessionCookie(user, cfg) });
        }
        case 'POST /api/login/options': {
          await authRateLimit();
          const options = await webauthn.generateAuthenticationOptions({ rpID: cfg.rpId, userVerification: 'required', allowCredentials: [] });
          return json(200, { cid: await challenge({ kind: 'login', challenge: options.challenge }), options });
        }
        case 'POST /api/login/verify': {
          await authRateLimit();
          const c = await takeChallenge(body.cid, 'login');
          const cred = core.creds.find(x => x.id === body.credential?.id);
          if (!cred) throw new ApiError(400, 'unknown passkey');
          let verified;
          try { verified = await webauthn.verifyAuthenticationResponse({ response: body.credential,
            expectedChallenge: c.challenge, expectedOrigin: cfg.origin, expectedRPID: cfg.rpId, requireUserVerification: true,
            credential: { id: cred.id, publicKey: Buffer.from(cred.publicKey, 'base64url'), counter: cred.counter, transports: cred.transports } }); }
          catch { throw new ApiError(400, 'passkey verification failed — try again'); }
          if (!verified.verified) throw new ApiError(400, 'not verified');
          const user = await store.tx(['core'], async tx => {
            const current = (await tx.get('core')) || emptyCore();
            const target = current.creds.find(x => x.id === cred.id);
            const user = current.users.find(u => u.id === cred.userId);
            if (!target || !user || user.disabled) throw new ApiError(403, 'this account is unavailable');
            if (target.counter !== cred.counter) throw new ApiError(409, 'another sign-in finished — try again');
            target.counter = verified.authenticationInfo.newCounter;
            await tx.set('core', current); return user;
          });
          return json(200, { user: userShape(user, cfg) }, { 'Set-Cookie': sessionCookie(user, cfg) });
        }
        case 'POST /api/logout': return json(200, { ok: true }, { 'Set-Cookie': sessionCookie(null, cfg, true) });
        case 'POST /api/logout/all':
          await mutate(false, async (core, user) => { user.sv = (user.sv || 0) + 1; });
          return json(200, { ok: true }, { 'Set-Cookie': sessionCookie(null, cfg, true) });
        case 'GET /api/data': {
          const state = await store.state(auth().id);
          return json(200, { state, revision: stateRevision(state) });
        }
        case 'PUT /api/data': {
          const user = auth();
          if (!body.state || typeof body.state !== 'object' || Array.isArray(body.state)) throw new ApiError(400, 'state required');
          if (body.userId && body.userId !== user.id) throw new ApiError(403, 'The signed-in profile changed. Sign in again before syncing.', 'sync_profile');
          delete body.state.active;
          let coachConsentCleared = false;
          const revision = await mutate(false, async (core, user, tx) => {
            const previous = await tx.state(user.id);
            const conflict = revisionError(body, previous);
            if (conflict) throw new ApiError(conflict.status, conflict.error, conflict.code);
            let revokedAt = await tx.get(consentKey(user.id));
            if (hasConsent(previous, revokedAt) && !hasConsent(body.state, revokedAt)) {
              revokedAt = await revokeConsent(tx, user.id, previous);
            }
            if (!hasConsent(body.state, revokedAt)) {
              clearConsent(body.state);
              coachConsentCleared = !!body.state.coach && typeof body.state.coach === 'object' && !Array.isArray(body.state.coach);
              await tx.remove('coach:' + user.id);
            }
            await tx.saveState(user.id, body.state);
            return stateRevision(body.state);
          }, ['state:' + user.id, 'coach:' + user.id]);
          // Automatic count-based reviews are event-driven; no always-running server required.
          await coach.afterSync(user.id).catch(() => {});
          return json(200, { ok: true, ts: body.state._ts || null, revision, ...(coachConsentCleared ? { coachConsentCleared: true } : {}) });
        }
        case 'POST /api/activity': {
          const user = auth();
          await mutate(false, async (_core, user, tx) => {
            if (!body.active) return tx.remove('presence:' + user.id);
            await tx.set('presence:' + user.id, { name: String(body.name || '').slice(0, 60),
              exIdx: +body.exIdx || 0, exTotal: +body.exTotal || 0, setsDone: +body.setsDone || 0,
              setsTotal: +body.setsTotal || 0, startedAt: +body.startedAt || Date.now(), updatedAt: Date.now() });
          }, ['presence:' + user.id]);
          return json(200, { ok: true });
        }
        case 'GET /api/admin/users': {
          auth(true);
          const states = new Map((await store.states()).map(s => [s.userId, s.state]));
          const users = await Promise.all(core.users.map(async u => {
            const S = states.get(u.id) || {}, workouts = S.workouts || [];
            return { ...userShape(u, cfg), created: u.created || null, disabled: !!u.disabled, invitedBy: u.invitedBy || null,
              workouts: workouts.length, lastWorkout: workouts.at(-1)?.d || null, lastSync: S._ts || null,
              hasPush: core.subs.some(s => s.userId === u.id), live: u.disabled ? null : live(await store.get('presence:' + u.id)) };
          }));
          return json(200, { users, invite_only: cfg.inviteOnly, now: Date.now() });
        }
        case 'GET /api/admin/user': {
          auth(true); const u = core.users.find(x => x.id === url.searchParams.get('id'));
          if (!u) throw new ApiError(404, 'no such user');
          const S = await store.state(u.id) || {};
          return json(200, { user: { ...userShape(u, cfg), created: u.created || null, disabled: !!u.disabled, invitedBy: u.invitedBy || null },
            unit: S.unit || 'kg', lastSync: S._ts || null,
            routines: (S.routines || []).map(r => ({ id: r.id, name: r.name, emoji: r.emoji, count: (r.ex || []).length })),
            bodyweight: S.bodyweight || [], workouts: (S.workouts || []).slice().reverse() });
        }
        case 'POST /api/admin/user/disable': {
          const result = await mutate(true, async (current, _admin, tx) => {
            const u = current.users.find(x => x.id === body.id);
            if (!u) throw new ApiError(404, 'no such user');
            if (userShape(u, cfg).admin) throw new ApiError(400, 'cannot disable an admin');
            u.disabled = !!body.disabled;
            if (u.disabled) { u.sv = (u.sv || 0) + 1; await tx.remove('presence:' + u.id); }
            return { ok: true, id: u.id, disabled: u.disabled };
          }); return json(200, result);
        }
        case 'GET /api/admin/invites': {
          auth(true);
          return json(200, { invites: core.invites.map(i => ({ ...i, usedByName: i.usedBy ? core.users.find(u => u.id === i.usedBy)?.name || null : null })), invite_only: cfg.inviteOnly });
        }
        case 'POST /api/admin/invites/new': {
          const invite = await mutate(true, async (current, admin) => {
            let code; do { code = crypto.randomBytes(12).toString('hex').toUpperCase(); } while (current.invites.some(i => i.code === code));
            const invite = { code, note: String(body.note || '').slice(0, 60), createdBy: admin.id, created: new Date().toISOString() };
            current.invites.push(invite); return invite;
          }); return json(200, { invite });
        }
        case 'POST /api/admin/invites/revoke':
          await mutate(true, async current => {
            const invite = current.invites.find(i => i.code === codeOf(body.code));
            if (!invite) throw new ApiError(404, 'no such code');
            if (invite.usedBy) throw new ApiError(400, 'already used — cannot revoke');
            // Recoverable tombstone rather than deleting invitation audit history.
            invite.revoked = true;
          }); return json(200, { ok: true });
        default:
          if (url.pathname.startsWith('/api/coach/') || url.pathname.startsWith('/api/admin/coach')) {
            const result = await coach.route(key, body, request);
            if (result) return result;
          }
          if (url.pathname.startsWith('/api/push/')) {
            const result = await notifications.route(key, body, request);
            if (result) return result;
          }
          return json(404, { error: 'not found' });
      }
    } catch (error) {
      if (error instanceof ApiError) return json(error.status, { error: error.message, ...(error.code ? { code: error.code } : {}) });
      // Database/provider errors may include credentials or payloads. Do not log their contents.
      console.error('ForgeFit function could not complete the request');
      return json(503, { error: 'ForgeFit cloud service is temporarily unavailable — try again shortly' });
    }
  };
}
