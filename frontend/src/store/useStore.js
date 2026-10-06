import { create } from 'zustand'
import { api } from '../lib/api.js'
import { localTZ } from '../lib/format.js'
import { registerCustom } from '../lib/exercises.js'
import { DEMO, DEMO_SEEDED } from '../lib/demo.js'
import { MOBILE, nativeLoad, nativeSave, syncReminder } from '../lib/mobile.js'

const KEY = 'gym_state_v1'
const OWNER_KEY = 'gym_state_owner'
const SYNC_KEY = 'gym_sync_v1'
const SAVED_KEY = 'gym_saved_profile:'
const RECOVERY_KEY = 'gym_recovery:'
const DEVICE_KEY = 'gym_device_profile:'
const PENDING_KEY = 'gym_pending_profile:'
export const DEF = {
  unit: 'kg', restSec: 90, sound: true, keepAwake: true, lang: 'en',
  theme: 'dark', accent: 'orange', _brandAccent: null, body: 'male', targetW: null,
  bodyweight: [], routines: [], week: {}, dayPlan: {},
  exWeights: {}, workouts: [], active: null, customEx: [], gifSize: 'full',
  // effort: which per-set effort scale is logged — 'none' | 'rir' | 'rpe'. null, not 'none', so
  // that a profile which never chose (loaded state is overlaid on DEF, on every path: local,
  // server pull, backup import) still falls back to the `showRir` boolean this replaced and
  // keeps the column it had. See effortOf.
  reminder: { on: false, time: '08:00', tz: null }, effort: null,
  // AI Coach (issue: AI enablement). null until the profile opts in — a null namespace is the
  // same app it was before the feature existed, which is what Epic F asks for. Shape and
  // bounds live in lib/coach.js.
  coach: null
}
const clone = o => JSON.parse(JSON.stringify(o))
const readJSON = key => { try { return JSON.parse(localStorage.getItem(key)) } catch { return null } }
const cachedUser = readJSON('gym_user')
const comparable = state => {
  const sort = value => Array.isArray(value) ? value.map(sort) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(k => [k, sort(value[k])])) : value
  const { active, _ts, _brandAccent, ...data } = Object.assign(clone(DEF), state)
  return JSON.stringify(sort(data))
}

function loadState() {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return Object.assign(clone(DEF), JSON.parse(raw))
  } catch (e) { /* ignore */ }
  return clone(DEF)
}

const hasData = st => !!((st.workouts || []).length || (st.routines || []).length || (st.bodyweight || []).length)

export const useStore = create((set, get) => {
  let pushTm = null
  let saveTm = null
  const sessionOwner = localStorage.getItem(OWNER_KEY)
  // A session identity wins over an interrupted/legacy owner marker. Never load
  // another account's compatibility mirror under the signed-in user's name.
  let owner = cachedUser?.id || sessionOwner || 'guest'
  const cached = readJSON(DEVICE_KEY + owner) || (sessionOwner && sessionOwner !== owner ? readJSON(SAVED_KEY + owner) : null)
  const initial = Object.assign(clone(DEF), cached?.state || (sessionOwner && sessionOwner !== owner ? {} : loadState()))
  let meta = cached?.meta || readJSON(SYNC_KEY)
  if (meta?.owner !== owner) meta = { owner, known: false, revision: null }
  let inFlight = null
  let epoch = 0
  let pending = cached ? !!cached.dirty : (!sessionOwner || sessionOwner === owner) && localStorage.getItem('gym_dirty') === '1'
  const tabId = globalThis.crypto?.randomUUID?.() || Date.now() + '-' + Math.random().toString(36).slice(2)
  const pendingKey = () => PENDING_KEY + owner + ':' + tabId
  const dirty = () => pending
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
  const device = () => readJSON(DEVICE_KEY + owner)
  const storageFailure = error => {
    const fault = Object.assign(new Error('Browser storage could not save this change. Your last saved copy was kept. Export a backup in Settings, free up storage, then retry the change.'), { code: 'storage', cause: error })
    set({ syncStatus: 'error', syncError: fault.message, storageError: fault.message })
    return fault
  }
  const journal = (state = get().S, isPending = pending) => {
    if (isPending) localStorage.setItem(pendingKey(), JSON.stringify({ owner, reason: 'Unsynced browser-tab copy', at: Date.now(), state }))
    else localStorage.removeItem(pendingKey())
  }
  const mirrorDevice = (state, isPending) => {
    if ((localStorage.getItem(OWNER_KEY) || 'guest') !== owner) return
    // Compatibility mirrors are not the durable source of truth. A full browser must not
    // turn a successful atomic device save into an apparent failure part-way through them.
    try {
      localStorage.setItem(KEY, JSON.stringify(state))
      localStorage.setItem(SYNC_KEY, JSON.stringify(meta))
      if (isPending) localStorage.setItem('gym_dirty', '1')
      else localStorage.removeItem('gym_dirty')
    } catch { /* the atomic per-profile copy above is already saved */ }
  }
  const writeDevice = (state = get().S, isPending = pending) => {
    // State, its cloud base and pending status travel together. A different tab must not
    // pair a new snapshot with an old tab's acknowledgment (or its account).
    try { localStorage.setItem(DEVICE_KEY + owner, JSON.stringify({ state, meta, dirty: isPending })) }
    catch (error) { throw storageFailure(error) }
    mirrorDevice(state, isPending)
  }
  const saveMeta = () => {
    try { if ((localStorage.getItem(OWNER_KEY) || 'guest') === owner) localStorage.setItem(SYNC_KEY, JSON.stringify(meta)) }
    catch { /* writeDevice persists the revision with its matching state */ }
  }
  const rememberRevision = revision => { meta = { owner, known: true, revision }; saveMeta() }
  const pendingCopies = () => {
    const copies = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith(PENDING_KEY)) { const copy = readJSON(key); if (copy) copies.push({ ...copy, key }) }
    }
    return copies
  }
  const acknowledgeCopies = state => {
    for (const copy of pendingCopies()) if (copy.owner === owner && same(copy.state, state)) localStorage.removeItem(copy.key)
  }
  let recoveredPending = pendingCopies().some(copy => copy.owner === owner && !same(copy.state, initial))
  const recoveryCopies = () => {
    const owners = [...new Set([owner, 'guest'])]
    const copies = owners.flatMap(id => readJSON(RECOVERY_KEY + id) || [])
    for (const copy of pendingCopies()) {
      if (owners.includes(copy.owner) && !copies.some(c => same(c.state, copy.state))) copies.push(copy)
    }
    return copies
  }
  const archive = (reason, state = get().S) => {
    if (!hasData(state) && !state.active) return
    const snapshot = Object.assign(clone(DEF), clone(state))
    const copies = readJSON(RECOVERY_KEY + owner) || []
    // Never discard an earlier recovery copy or clear live data if storage is full.
    if (!copies.some(copy => JSON.stringify(copy.state) === JSON.stringify(snapshot))) {
      localStorage.setItem(RECOVERY_KEY + owner, JSON.stringify([...copies, { reason, at: Date.now(), state: snapshot }]))
    }
    set({ recoveryCopies: recoveryCopies() })
  }
  const failure = error => {
    pending = true
    try {
      journal()
      if (!device() || same(device().state, get().S)) writeDevice()
    } catch (storageError) { storageFailure(storageError) }
    set({ syncStatus: error.status === 409 ? 'conflict' : 'error', syncError: get().storageError || error.message || 'Could not sync. Your changes are still on this device.' })
    return false
  }
  const conflict = () => failure(Object.assign(new Error('Another copy of this profile has different data. Your changes are safe; review the sync conflict in Settings.'), { status: 409 }))
  const readRemote = async () => {
    const data = await api('/api/data')
    if (!Object.hasOwn(data, 'revision')) throw new Error('Refresh the app and server together before syncing. Your local changes are safe.')
    return data
  }
  const refreshDevice = () => {
    if (get().user && readJSON('gym_user')?.id !== get().user.id) return failure(new Error('The signed-in profile changed in another tab. Reload before syncing. Your device copy was kept.'))
    if (recoveredPending) return conflict()
    const shared = device()
    if (!shared) return true
    if (!same(shared.state, get().S)) {
      if (pending || get().S.active) {
        archive('Browser-tab copy before a concurrent edit')
        return conflict()
      }
      const S = Object.assign(clone(DEF), shared.state)
      registerCustom(S.customEx)
      set({ S })
      if (MOBILE) nativePersist()
    }
    if (shared.meta?.owner === owner) meta = shared.meta
    pending = !!shared.dirty
    try { journal() } catch (error) { throw storageFailure(error) }
    if (!pending) acknowledgeCopies(get().S)
    if (get().user && get().syncStatus !== 'conflict') set({ syncStatus: pending ? 'pending' : 'synced', syncError: '' })
    set({ recoveryCopies: recoveryCopies() })
    return true
  }

  // Mobile build: mirror the state into a file in the app's data directory (survives WebView
  // storage eviction) and keep the native reminder schedule in step with the weekly plan.
  const nativePersist = () => {
    clearTimeout(saveTm)
    saveTm = setTimeout(() => { saveTm = null; nativeSave(get().S); syncReminder(get().S) }, 800)
  }

  const persist = (S, push = true, stamp = true, publish = true) => {
    if (stamp) S._ts = Math.max(Date.now(), (Number(get().S?._ts) || 0) + 1)
    const previous = get().S, wasPending = pending, nextPending = pending || !!(push && get().user)
    // Each tab keeps its own durable pending copy before publishing to the shared cache.
    // Publish to the UI only after saving succeeds: quota errors must not finish a workout
    // or claim that an in-memory-only change is safely on this device.
    let journalWritten = false
    try {
      journal(S, nextPending); journalWritten = true
      if (publish) {
        if (get().user?.id === readJSON('gym_user')?.id) localStorage.setItem(OWNER_KEY, owner)
        writeDevice(S, nextPending)
      }
    } catch (error) {
      if (journalWritten) {
        try { journal(previous, wasPending) } catch { /* retain the recoverable pending copy */ }
      }
      throw storageFailure(error)
    }
    pending = nextPending
    registerCustom(S.customEx)
    set({ S, storageError: '' })
    if (MOBILE) nativePersist()
    if (push && get().user) {
      if (get().syncStatus !== 'conflict') set({ syncStatus: 'pending', syncError: '' })
      clearTimeout(pushTm)
      pushTm = setTimeout(() => { pushTm = null; get().pushState() }, 1500)
    }
  }

  // localStorage is atomic per key, not per account. Stage the destination cache and
  // session keys before publishing *any* new owner/user/state in memory. Roll back
  // successful writes in reverse order if a later write hits quota; the failing key
  // itself is unchanged. Compatibility mirrors remain best-effort, as in persist().
  const sessionWrites = entries => {
    const written = []
    try {
      for (const [key, value] of entries) {
        const previous = localStorage.getItem(key)
        if (previous === value) continue
        if (value === null) localStorage.removeItem(key)
        else localStorage.setItem(key, value)
        written.push([key, previous])
      }
    } catch (error) {
      for (const [key, previous] of written.reverse()) {
        try {
          if (previous === null) localStorage.removeItem(key)
          else localStorage.setItem(key, previous)
        } catch { /* Keep the outgoing cache/recovery copies if storage became unavailable. */ }
      }
      throw storageFailure(error)
    }
  }
  const selectProfile = (user, { adoptLocal = false, guest = false, signedOut = false } = {}) => {
    const toGuest = guest || signedOut
    const nextOwner = toGuest ? 'guest' : user?.id || owner
    const switching = nextOwner !== owner
    let S = get().S, nextMeta = meta, nextPending = pending
    const entries = []
    if (switching) {
      if (!signedOut) {
        try {
          archive(guest ? 'Before switching to guest mode' : 'Before signing into another profile')
          localStorage.setItem(SAVED_KEY + owner, JSON.stringify({ state: S, meta, dirty: pending }))
        } catch (error) { throw storageFailure(error) }
      }
      const saved = readJSON(DEVICE_KEY + nextOwner) || readJSON(SAVED_KEY + nextOwner)
      S = Object.assign(clone(DEF), adoptLocal ? S : saved?.state)
      nextMeta = adoptLocal ? { owner: nextOwner, known: true, revision: null }
        : !toGuest && saved?.meta?.owner === nextOwner ? saved.meta : { owner: nextOwner, known: false, revision: null }
      nextPending = !toGuest && !!(adoptLocal || saved?.dirty)
      entries.push([DEVICE_KEY + nextOwner, JSON.stringify({ state: S, meta: nextMeta, dirty: nextPending })],
        [PENDING_KEY + nextOwner + ':' + tabId, nextPending
          ? JSON.stringify({ owner: nextOwner, reason: 'Unsynced browser-tab copy', at: Date.now(), state: S }) : null],
        [OWNER_KEY, nextOwner])
    }
    entries.push(['gym_user', user ? JSON.stringify(user) : null])
    if (toGuest || user) entries.push(['gym_guest', guest ? '1' : null])
    if (signedOut) entries.push([KEY, null], ['gym_dirty', null])
    sessionWrites(entries)
    if (switching) {
      clearTimeout(pushTm); pushTm = null; epoch++; inFlight = null
      owner = nextOwner; meta = nextMeta; pending = nextPending; recoveredPending = false
      mirrorDevice(S, pending)
      registerCustom(S.customEx)
    }
    set({ user, ...(switching ? { S, storageError: '', profileLoading: !toGuest && !adoptLocal,
      syncStatus: pending ? 'pending' : 'idle', syncError: '', recoveryCopies: recoveryCopies() } : {}) })
    if (switching && MOBILE) nativePersist()
  }

  // A setting changed right before switching away/closing the tab must not get lost mid-debounce
  // (e.g. setting the reminder time then immediately backgrounding to test it). On mobile the
  // same applies to the file mirror — backgrounding is often the last thing before the OS
  // kills the app.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden') return
    if (MOBILE && saveTm) {
      clearTimeout(saveTm)
      saveTm = null
      nativeSave(get().S)
    }
    if (pushTm) {
      clearTimeout(pushTm)
      pushTm = null
      get().pushState()
    }
  })
  if (typeof window !== 'undefined') window.addEventListener('online', () => {
    if (get().user && dirty() && get().syncStatus !== 'conflict') get().pushState()
  })
  if (typeof window !== 'undefined') window.addEventListener('storage', event => {
    if (event.key !== DEVICE_KEY + owner) return
    try { refreshDevice() } catch (error) { set({ syncStatus: 'error', syncError: error.message }) }
  })

  // Everything a sign-out leaves behind on this device, whichever way it was triggered.
  const clearLocalSession = () => {
    const previousOwner = owner, previousPendingKey = pendingKey()
    selectProfile(null, { signedOut: true })
    // Only discard the confirmed-synced account cache after the guest state and
    // cleared session are durable. Quota failure leaves the old profile intact.
    localStorage.removeItem(SAVED_KEY + previousOwner)
    localStorage.removeItem(DEVICE_KEY + previousOwner)
    localStorage.removeItem(previousPendingKey)
    set({ syncStatus: 'idle', syncError: '', profileLoading: false, recoveryCopies: recoveryCopies() })
  }
  const logout = async path => {
    const uid = get().user?.id, runEpoch = epoch
    if (!uid) return
    const current = () => get().user?.id === uid && epoch === runEpoch && readJSON('gym_user')?.id === uid
    const changed = () => new Error('The profile changed while signing out. The current device copy was kept.')
    if (get().S.active) throw new Error('Finish or discard your active workout before signing out. It is saved only on this device.')
    const saved = await get().pushState()
    if (!current()) throw changed()
    if (!saved) throw new Error('Could not save your changes. You are still signed in; your workouts are safe on this device.')
    const version = get().S._ts
    await api(path, { method: 'POST', body: '{}' })
    if (!current()) throw changed()
    refreshDevice()
    if (dirty() || get().S._ts !== version) {
      get().setUser(null)
      throw new Error('New changes were kept on this device. Sign in again to sync them.')
    }
    clearLocalSession()
  }

  return {
    S: (() => { registerCustom(initial.customEx); return initial })(),
    user: cachedUser,
    ready: false,
    profileLoading: false,
    syncStatus: cachedUser && recoveredPending ? 'conflict' : cachedUser && dirty() ? 'pending' : 'idle',
    syncError: '',
    storageError: '',
    recoveryCopies: recoveryCopies(),
    // Instance capabilities from GET /api/config. `config.coach` is present only when the
    // owner has both enabled the Coach and connected a provider — every Coach entry point in
    // the app hangs off it, so an unconfigured instance renders exactly what it always did.
    config: null,

    async refreshConfig() {
      const config = await api('/api/config')
      set({ config })
      return config
    },

    // Mutate a draft of S via producer fn, then persist + schedule sync.
    update(mut, push = true) {
      try {
        const publish = refreshDevice()
        const S = clone(get().S)
        mut(S)
        persist(S, push, true, publish)
        return true
      } catch (error) {
        if (error.code !== 'storage') throw error
        return false
      }
    },
    replaceState(S, push = false) { const publish = refreshDevice(); persist(clone(S), push, true, publish) },
    importBackup(S) {
      const publish = refreshDevice()
      archive('Device copy before importing a backup')
      persist(clone(S), true, true, publish)
    },
    async resetAll() {
      const publish = refreshDevice()
      archive('Device copy before resetting everything')
      persist(clone(DEF), true, true, publish)
      if (get().user && !await get().pushState()) throw new Error('Reset is saved on this device; cloud sync still needs attention in Settings.')
    },

    isGuest: () => localStorage.getItem('gym_guest') === '1',
    setGuest(v) {
      if (v) selectProfile(null, { guest: true })
      else sessionWrites([['gym_guest', null]])
      set({ profileLoading: false, syncStatus: 'idle', syncError: '', recoveryCopies: recoveryCopies() })
    },

    setUser(u, { adoptLocal = false } = {}) {
      selectProfile(u, { adoptLocal })
    },

    async pushState() {
      if (!get().user || get().syncStatus === 'conflict') return false
      try { if (!refreshDevice()) return false }
      catch (error) { return failure(error) }
      clearTimeout(pushTm); pushTm = null
      if (inFlight) return inFlight
      const uid = get().user.id, runEpoch = epoch
      const current = () => get().user?.id === uid && epoch === runEpoch && readJSON('gym_user')?.id === uid
      const work = async () => {
        try {
          if (!meta.known) {
            const remote = await readRemote()
            if (!current()) return false
            if (remote.state && comparable(remote.state) !== comparable(get().S)) return conflict()
            rememberRevision(remote.revision)
          }
          while (current()) {
            if (!dirty()) { writeDevice(); set({ syncStatus: 'synced', syncError: '' }); return true }
            const deviceSnapshot = clone(get().S), snapshot = clone(deviceSnapshot), version = snapshot._ts
            delete snapshot.active
            set({ syncStatus: 'syncing', syncError: '' })
            const result = await api('/api/data', { method: 'PUT', body: JSON.stringify({ state: snapshot, userId: uid, baseRevision: meta.revision }) })
            if (!current()) return false
            if (!Object.hasOwn(result, 'revision')) throw new Error('The server needs the matching sync update. Your local changes are safe.')
            // Another tab edited during this upload. Do not acknowledge its unsent snapshot
            // or silently rebase it onto this response; both tab copies remain recoverable.
            if (device() && !same(device().state, get().S)) { archive('Browser-tab copy after a concurrent upload'); return conflict() }
            rememberRevision(result.revision)
            acknowledgeCopies(deviceSnapshot)
            // The server can reject consent restored from an old backup. Apply only that
            // correction, not the uploaded snapshot: newer workouts/intake must survive,
            // and a newer explicit acceptance belongs to the next serialized save.
            if (result.coachConsentCleared && get().S.coach && same(get().S.coach.consent, snapshot.coach?.consent)) {
              const next = clone(get().S)
              next.coach.consent = null; next.coach.cadence = 'off'
              persist(next, false, false)
            }
            if (get().S._ts === version) {
              pending = false; journal(); writeDevice()
              set({ syncStatus: 'synced', syncError: '' })
              return true
            }
            journal(); writeDevice()
            // An edit made while uploading belongs to the next serialized save, never the
            // acknowledgment for an older snapshot.
          }
          return false
        } catch (error) { return current() ? failure(error) : false }
      }
      const promise = work().finally(() => { if (inFlight === promise) inFlight = null })
      inFlight = promise
      return promise
    },
    async pullState() {
      const uid = get().user?.id, runEpoch = epoch
      if (!uid) return false
      const current = () => get().user?.id === uid && epoch === runEpoch && readJSON('gym_user')?.id === uid
      try {
        if (inFlight) await inFlight
        if (!current()) return false
        if (!refreshDevice()) return false
        const beforeRevision = meta.revision
        const { state, revision } = await readRemote()
        if (!current()) return false
        if (!refreshDevice()) return false
        // An upload completed while this GET was in flight. Fetch again rather than applying
        // a response that was read before that upload and undoing the acknowledged edit.
        if (meta.revision !== beforeRevision) return await get().pullState()
        const S = get().S
        if (dirty()) {
          if ((meta.known && meta.revision === revision) || (!meta.known && comparable(state) === comparable(S))) {
            rememberRevision(revision)
            return await get().pushState()
          }
          return conflict()
        }
        // Old installations had no base revision and sometimes failed to mark pending edits.
        // Never silently throw away a newer legacy device copy during this upgrade.
        if (!meta.known && hasData(S) && (S._ts || 0) > (state?._ts || 0) && comparable(S) !== comparable(state)) return conflict()
        rememberRevision(revision)
        const next = Object.assign(clone(DEF), state)
        if (S.active) next.active = S.active
        persist(next, false, false)
        set({ syncStatus: 'synced', syncError: '' })
        return true
      } catch (error) {
        if (current()) set({ syncStatus: 'error', syncError: error.message || 'Could not load your cloud profile. The local copy is unchanged.' })
        return false
      } finally { if (current()) set({ profileLoading: false }) }
    },

    async resolveSyncConflict(choice) {
      const uid = get().user?.id, runEpoch = epoch
      if (!uid || !['local', 'cloud'].includes(choice)) return false
      const current = () => get().user?.id === uid && epoch === runEpoch && readJSON('gym_user')?.id === uid
      try {
        if (inFlight) await inFlight
        if (!current()) return false
        const remote = await readRemote()
        if (!current()) return false
        if (device() && !same(device().state, get().S)) archive('Other browser-tab copy before resolving sync', device().state)
        for (const copy of pendingCopies().filter(copy => copy.owner === owner && copy.key !== pendingKey())) {
          archive('Pending browser-tab copy before resolving sync', copy.state)
          localStorage.removeItem(copy.key)
        }
        recoveredPending = false
        archive(choice === 'cloud' ? 'Device copy before using cloud data' : 'Cloud copy before using device data', choice === 'cloud' ? get().S : remote.state || clone(DEF))
        rememberRevision(remote.revision)
        if (choice === 'cloud') {
          const next = Object.assign(clone(DEF), remote.state)
          if (get().S.active) next.active = get().S.active
          pending = false
          persist(next, false, false)
          set({ syncStatus: 'synced', syncError: '', profileLoading: false })
          return true
        }
        pending = true
        persist(clone(get().S), false, false)
        set({ syncStatus: 'pending', syncError: '' })
        return await get().pushState()
      } catch (error) { return current() ? failure(error) : false }
    },

    signOut() { return logout('/api/logout') },

    // "Sign out everywhere": the server bumps this profile's session version, which kills every
    // session it has on any device — this browser included, so the app has to end up exactly
    // where a normal signOut leaves it. The request is never swallowed: if it fails
    // the sessions elsewhere are all still valid, and wiping this device's copy of the data
    // would sign the user out of the one place the bump didn't reach. Caller reports the error.
    signOutAll() { return logout('/api/logout/all') },

    // Demo build only: drop the seeded example profile back in (Settings → "Reset demo data").
    // Dynamic import so the generator never ships in a self-hosted bundle.
    async resetDemo() {
      const { buildDemoState } = await import('../lib/demoSeed.js')
      localStorage.removeItem('gym_dirty')
      pending = false
      persist(Object.assign(clone(DEF), buildDemoState()), false)
    },

    // Boot: ask the server who we are, then pull.
    async boot() {
      // Mobile build: no backend either — restore from the file mirror (the durable copy;
      // localStorage may have been evicted since the last run) and go straight in.
      if (MOBILE) {
        const saved = await nativeLoad()
        const S = get().S
        if (saved && (!hasData(S) || (saved._ts || 0) >= (S._ts || 0))) {
          persist(Object.assign(clone(DEF), saved), false)
        } else if (hasData(S)) {
          nativeSave(S)   // first run after an update from a file-less version: seed the mirror
        }
        get().setGuest(true)
        syncReminder(get().S)
        set({ ready: true })
        return
      }
      // Demo build (GitHub Pages): no backend at all — seed once, stay in guest mode.
      if (DEMO) {
        if (!localStorage.getItem(DEMO_SEEDED)) {
          localStorage.setItem(DEMO_SEEDED, '1')
          await get().resetDemo()
        }
        get().setGuest(true)
        set({ ready: true })
        return
      }
      // Instance capabilities are public and needed whether or not anyone is signed in.
      try { await get().refreshConfig() } catch (e) { /* offline — assume nothing extra */ }
      try {
        const me = await api('/api/me')
        get().setUser(me.user)
        await get().pullState()
        // Re-stamp the reminder's timezone on every load — keeps it correct if you're travelling,
        // without needing to revisit Settings.
        const tz = localTZ()
        if (get().S.reminder?.on && get().S.reminder.tz !== tz) {
          get().update(s => { s.reminder = { ...s.reminder, tz } })
        }
      } catch (e) {
        if (e.status === 401) get().setUser(null)
      }
      set({ ready: true })
    }
  }
})

export { hasData }
