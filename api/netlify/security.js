import crypto from 'node:crypto';

export class ApiError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}
export const emptyCore = () => ({ users: [], creds: [], subs: [], invites: [] });
export const isOn = value => /^(1|true|yes|on)$/i.test(String(value || ''));
export const randomId = () => crypto.randomBytes(16).toString('base64url');
export const fingerprint = secret => crypto.createHash('sha256').update(secret).digest('hex');
export function equal(a, b) {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}
export function mac(secret, text) { return crypto.createHmac('sha256', secret).update(text).digest('base64url'); }
export function sign(secret, text) { return text + '.' + mac(secret, text); }
export function verified(secret, token) {
  const i = String(token || '').lastIndexOf('.');
  if (i < 0 || !equal(token.slice(i + 1), mac(secret, token.slice(0, i)))) return null;
  return token.slice(0, i);
}
export function sessionUser(request, core, secret, now = Date.now()) {
  const cookie = (request.headers.get('cookie') || '').split(';').map(s => s.trim()).find(s => s.startsWith('gymsid='));
  const payload = verified(secret, cookie?.slice(7));
  if (!payload) return null;
  const [uid, expiry, version] = payload.split(':');
  if (!Number.isFinite(+expiry) || +expiry <= now || !Number.isInteger(+version)) return null;
  const user = core.users.find(u => u.id === uid && !u.disabled && (u.sv || 0) === +version);
  return user || null;
}
export function sessionCookie(user, cfg, clear = false) {
  const days = cfg.sessionDays;
  const token = clear ? '' : sign(cfg.secret, `${user.id}:${Date.now() + days * 86400000}:${user.sv || 0}`);
  return `gymsid=${token}; Path=/; Max-Age=${clear ? 0 : days * 86400}; HttpOnly;${cfg.origin.startsWith('https:') ? ' Secure;' : ''} SameSite=Lax`;
}
export const userShape = (user, cfg) => ({ id: user.id, name: user.name, admin: user.admin === true || cfg.adminUids.includes(user.id) });
export function requireUser(request, core, cfg, admin = false) {
  const user = sessionUser(request, core, cfg.secret);
  if (!user) throw new ApiError(401, 'not signed in');
  if (admin && !userShape(user, cfg).admin) throw new ApiError(403, 'forbidden');
  return user;
}
export function configuration(env) {
  const origin = String(env.ORIGIN || env.URL || '').replace(/\/$/, '');
  if (!env.DATABASE_URL || String(env.SESSION_SECRET || '').length < 32 || !/^https:\/\//.test(origin)) {
    throw new ApiError(503, 'ForgeFit needs its private Netlify database and session settings');
  }
  const parsed = new URL(origin);
  if (parsed.origin !== origin) throw new ApiError(503, 'ForgeFit origin is not configured correctly');
  return {
    origin, rpId: env.RP_ID || parsed.hostname, rpName: env.RP_NAME || 'ForgeFit', secret: env.SESSION_SECRET,
    inviteOnly: env.INVITE_ONLY === undefined ? true : isOn(env.INVITE_ONLY),
    ownerCode: String(env.OWNER_SETUP_CODE || '').trim().toUpperCase(),
    adminUids: String(env.ADMIN_UIDS || '').split(',').map(s => s.trim()).filter(Boolean),
    sessionDays: Math.max(1, Math.min(90, +env.SESSION_DAYS || 90)),
    coachDisabled: isOn(env.COACH_DISABLED), reminders: isOn(env.SCHEDULED_NOTIFICATIONS_ENABLED)
  };
}
export function protectRequest(request, origin) {
  if (['GET', 'HEAD'].includes(request.method)) return;
  const supplied = request.headers.get('origin');
  if ((supplied && supplied !== origin) || request.headers.get('sec-fetch-site') === 'cross-site') throw new ApiError(403, 'cross-site request refused');
  if (!/^application\/json(?:;|$)/i.test(request.headers.get('content-type') || '')) throw new ApiError(415, 'JSON content type required');
}
export async function readBody(request, maxBytes = 5 * 1024 * 1024) {
  if (+(request.headers.get('content-length') || 0) > maxBytes) throw new ApiError(413, 'body too large');
  let size = 0; const chunks = [];
  if (request.body) for await (const chunk of request.body) {
    size += chunk.length;
    if (size > maxBytes) throw new ApiError(413, 'body too large');
    chunks.push(chunk);
  }
  try {
    const result = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error();
    return result;
  } catch { throw new ApiError(400, 'bad json'); }
}
export const json = (status, value, headers = {}) => new Response(JSON.stringify(value), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers }
});

// Background workers accept only short-lived, server-signed task envelopes. No credentials,
// payloads, or user workouts appear in their HTTP body or URL.
export function taskToken(cfg, task) { return sign(cfg.secret, JSON.stringify({ ...task, expires: Date.now() + 10 * 60000 })); }
export function readTask(cfg, token) {
  const value = verified(cfg.secret, token);
  if (!value) return null;
  try { const task = JSON.parse(value); return task.expires > Date.now() ? task : null; } catch { return null; }
}
