import crypto from 'node:crypto';

// A revision is server-derived, not a device clock. Canonical keys make it stable after
// Postgres JSONB reorders an object; any server-side change also invalidates old saves.
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}

export function stateRevision(state) {
  return state == null ? null : crypto.createHash('sha256').update(JSON.stringify(canonical(state))).digest('hex');
}

export function revisionError(body, previous) {
  if (!Object.hasOwn(body, 'baseRevision')) {
    return { status: 428, code: 'sync_version', error: 'Refresh ForgeFit before syncing. Your changes are still on this device.' };
  }
  if (body.baseRevision !== stateRevision(previous)) {
    return { status: 409, code: 'sync_conflict', error: 'Another device changed this profile. Your local changes are safe; review the sync conflict in Settings.' };
  }
  return null;
}
