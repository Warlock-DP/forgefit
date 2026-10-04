// Match the explicit disclosure accepted by the client. A stale device snapshot
// cannot undo a withdrawal recorded in the authoritative cloud database.
export const CONSENT_VERSION = 1;
export const consentKey = uid => 'coach-consent:' + uid;

export function consentAt(state) {
  const consent = state?.coach?.consent;
  if (consent?.version !== CONSENT_VERSION || typeof consent.agreedAt !== 'string') return 0;
  const at = Date.parse(consent.agreedAt);
  return Number.isFinite(at) && at > 0 && at <= Date.now() + 5 * 60000 ? at : 0;
}
export function hasConsent(state, revokedAt = 0) {
  return consentAt(state) > (Number(revokedAt) || 0);
}
export async function revokeConsent(tx, uid, previous) {
  // Include the previously accepted timestamp in case that device's clock is ahead.
  const at = Math.max(Date.now(), Number(await tx.get(consentKey(uid))) || 0, consentAt(previous));
  await tx.set(consentKey(uid), at);
  return at;
}
export function clearConsent(state) {
  if (state?.coach && typeof state.coach === 'object' && !Array.isArray(state.coach)) {
    state.coach.consent = null;
    state.coach.cadence = 'off';
  }
}
