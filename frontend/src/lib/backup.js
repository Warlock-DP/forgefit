// Validate before showing the destructive import confirmation. Older exports may omit
// optional preferences, but a truthy object is never a substitute for an array of workouts.
const object = value => !!value && typeof value === 'object' && !Array.isArray(value)
const fail = path => { throw new Error('Invalid backup field: ' + path) }
const obj = (value, path) => { if (!object(value)) fail(path) }
const list = (value, path, visit) => {
  if (!Array.isArray(value)) fail(path)
  value.forEach((item, i) => visit(item, path + '[' + i + ']'))
}
const string = (value, path) => { if (typeof value !== 'string') fail(path) }
const id = (value, path) => { string(value, path); if (!value.trim()) fail(path) }
const number = (value, path) => { if (typeof value !== 'number' || !Number.isFinite(value)) fail(path) }
const timestamp = (value, path) => {
  number(value, path)
  if (!Number.isFinite(new Date(value).getTime())) fail(path)
}
const optional = (value, key, path, check) => { if (value[key] != null) check(value[key], path + '.' + key) }
const fields = (value, path, names, check) => names.forEach(key => optional(value, key, path, check))
const date = (value, path) => {
  string(value, path)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) fail(path)
}
const safeKeys = (value, path = 'backup', depth = 0) => {
  if (depth > 50) fail(path)
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) fail(path + '.' + key)
    safeKeys(child, path + '.' + key, depth + 1)
  }
}
function prescription(value, path) {
  obj(value, path)
  fields(value, path, ['id', 'mode', 'prog', 'sg'], string)
  fields(value, path, ['sets', 'reps', 'sec', 'min', 'speed', 'weight', 'inc', 'repsMin'], number)
}
function routine(value, path) {
  obj(value, path); id(value.id, path + '.id')
  fields(value, path, ['name', 'emoji', 'prog'], string)
  if (value.name == null) value.name = 'Routine'
  list(value.ex, path + '.ex', (e, p) => { prescription(e, p); id(e.id, p + '.id') })
}
function workout(value, path) {
  obj(value, path); id(value.id, path + '.id'); date(value.d, path + '.d')
  fields(value, path, ['name', 'routineId', 'note'], string)
  fields(value, path, ['start', 'end', 'bw', 'vol', 'cur'], number)
  if (value.name == null) value.name = 'Workout'
  if (value.entries == null) value.entries = []
  list(value.entries, path + '.entries', (entry, p) => {
    obj(entry, p); id(entry.id, p + '.id')
    fields(entry, p, ['n', 'sg'], string); optional(entry, 'topW', p, number)
    optional(entry, 'target', p, prescription)
    if (entry.plan != null) {
      obj(entry.plan, p + '.plan')
      if (entry.plan.why != null) list(entry.plan.why, p + '.plan.why', (v, k) => { if (typeof v !== 'string' && typeof v !== 'number') fail(k) })
    }
    list(entry.sets, p + '.sets', (set, s) => {
      obj(set, s)
      fields(set, s, ['w', 'r', 'sec', 'min', 'speed', 'rir', 'rpe'], number)
      optional(set, 'done', s, (v, k) => { if (typeof v !== 'boolean') fail(k) })
    })
  })
  if (value.prs == null) value.prs = []
  list(value.prs, path + '.prs', string)
}
function schedule(value, path, dated = false) {
  obj(value, path)
  for (const [key, item] of Object.entries(value)) {
    if (dated) date(key, path + '.' + key)
    else if (!/^[0-6]$/.test(key)) fail(path + '.' + key)
    if (item !== null) string(item, path + '.' + key)
  }
}
function coach(value, path) {
  obj(value, path)
  if (value.consent != null) {
    obj(value.consent, path + '.consent')
    string(value.consent.agreedAt, path + '.consent.agreedAt')
    if (!Number.isFinite(Date.parse(value.consent.agreedAt))) fail(path + '.consent.agreedAt')
    number(value.consent.version, path + '.consent.version')
  }
  if (value.profile != null) {
    const p = value.profile; obj(p, path + '.profile')
    fields(p, path + '.profile', ['goal', 'experience', 'limitations', 'likes', 'dislikes', 'notes'], string)
    fields(p, path + '.profile', ['daysPerWeek', 'sessionMin'], number)
    optional(p, 'equipment', path + '.profile', (v, k) => list(v, k, string))
    optional(p, 'preferredDays', path + '.profile', (v, k) => list(v, k, number))
  }
  if (value.cadence != null && value.cadence !== 'off') {
    obj(value.cadence, path + '.cadence')
    optional(value.cadence, 'everyWorkouts', path + '.cadence', number)
    if (value.cadence.weekly != null) {
      obj(value.cadence.weekly, path + '.cadence.weekly')
      number(value.cadence.weekly.day, path + '.cadence.weekly.day')
      string(value.cadence.weekly.time, path + '.cadence.weekly.time')
    }
  }
  if (value.log == null) value.log = []
  list(value.log, path + '.log', (e, p) => {
    obj(e, p); fields(e, p, ['id', 'kind', 'summary'], string); timestamp(e.at, p + '.at')
    optional(e, 'decisions', p, (v, k) => list(v, k, obj))
    optional(e, 'notes', p, (v, k) => list(v, k, string))
  })
  if (value.snapshots == null) value.snapshots = []
  list(value.snapshots, path + '.snapshots', (s, p) => {
    obj(s, p); list(s.routines, p + '.routines', routine); schedule(s.week, p + '.week')
  })
}

export function parseBackup(raw, defaults = {}) {
  if (typeof raw === 'string' && new TextEncoder().encode(raw).length > 5 * 1024 * 1024) throw new Error('Backup is larger than the 5 MB limit')
  const value = typeof raw === 'string' ? JSON.parse(raw) : raw
  obj(value, 'backup'); safeKeys(value)
  // Clone so validation/normalization cannot change the currently loaded profile.
  const data = JSON.parse(JSON.stringify(value))
  list(data.workouts, 'workouts', workout)
  list(data.routines, 'routines', routine)
  optional(data, 'bodyweight', 'backup', (v, p) => list(v, p, (b, k) => { obj(b, k); date(b.d, k + '.d'); number(b.w, k + '.w'); optional(b, 't', k, number) }))
  optional(data, 'customEx', 'backup', (v, p) => list(v, p, (e, k) => {
    obj(e, k); id(e.id, k + '.id'); string(e.n, k + '.n'); string(e.bp, k + '.bp')
    fields(e, k, ['desc', 'tg', 'eq', 'img', 'gif'], string)
    fields(e, k, ['sm', 'st'], (a, q) => list(a, q, string))
  }))
  optional(data, 'week', 'backup', (v, p) => schedule(v, p))
  optional(data, 'dayPlan', 'backup', (v, p) => schedule(v, p, true))
  optional(data, 'exWeights', 'backup', (v, p) => {
    obj(v, p)
    Object.entries(v).forEach(([key, w]) => { obj(w, p + '.' + key); number(w.w, p + '.' + key + '.w'); optional(w, 'd', p + '.' + key, date) })
  })
  fields(data, 'backup', ['unit', 'lang', 'theme', 'accent', 'body', 'gifSize', '_brandAccent', 'effort'], string)
  fields(data, 'backup', ['restSec', 'targetW'], number)
  fields(data, 'backup', ['sound', 'keepAwake', 'showRir'], (v, p) => { if (typeof v !== 'boolean') fail(p) })
  optional(data, 'reminder', 'backup', (v, p) => {
    obj(v, p); optional(v, 'on', p, (b, k) => { if (typeof b !== 'boolean') fail(k) }); fields(v, p, ['time', 'tz'], string)
  })
  optional(data, 'active', 'backup', workout)
  optional(data, 'coach', 'backup', coach)
  // Required collection/map fields cannot be replaced by null. Nullable preferences keep
  // their historical meaning; a legacy export that omits fields receives today's defaults.
  for (const key of ['bodyweight', 'customEx', 'week', 'dayPlan', 'exWeights', 'reminder']) if (Object.hasOwn(data, key) && data[key] === null) fail(key)
  if (data._ts != null && (typeof data._ts !== 'number' || !Number.isFinite(data._ts))) delete data._ts
  return Object.assign(JSON.parse(JSON.stringify(defaults)), data)
}
