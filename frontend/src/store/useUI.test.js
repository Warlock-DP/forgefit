import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api.js', () => ({ api: vi.fn(async () => ({ ok: true })) }))
vi.mock('../lib/demo.js', () => ({ DEMO: false, DEMO_SEEDED: 'test-demo' }))
vi.mock('../lib/mobile.js', () => ({ MOBILE: false, nativeLoad: vi.fn(), nativeSave: vi.fn(), syncReminder: vi.fn(), shareExport: vi.fn() }))
vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), vibrate: vi.fn() }))

let useStore, useUI, beginWorkout, finishWorkout
beforeEach(async () => {
  vi.resetModules()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-05T12:00:00Z'))
  const values = new Map()
  vi.stubGlobal('localStorage', {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  })
  vi.stubGlobal('document', new EventTarget())
  vi.stubGlobal('window', new EventTarget())
  ;({ useStore } = await import('./useStore.js'))
  ;({ useUI } = await import('./useUI.js'))
  ;({ beginWorkout, finishWorkout } = await import('../sheets.jsx'))
})
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals() })

const workout = () => ({ id: 'session', name: 'Test session', d: '2026-10-05', start: Date.now(),
  entries: [{ id: 'test-exercise', target: { mode: 'time', sec: 5 }, sets: [{ sec: 5, w: 0, done: true }] }] })

describe('work timers belong to their workout', () => {
  it('does not finish a workout or show a saved summary when browser storage is full', () => {
    useStore.getState().update(s => { s.active = workout() })
    useUI.getState().startWork(5, 'Hold', vi.fn())
    const before = useStore.getState().S, original = localStorage.setItem
    localStorage.setItem = () => { throw Object.assign(new Error('Storage full'), { name: 'QuotaExceededError' }) }
    expect(() => finishWorkout()).not.toThrow()
    expect(useStore.getState().S).toBe(before)
    expect(useStore.getState().S.active.id).toBe('session')
    expect(useStore.getState().S.workouts).toHaveLength(0)
    expect(useUI.getState().sheets).toHaveLength(0)
    expect(useUI.getState().work).not.toBeNull()
    expect(useStore.getState().storageError).toBeTruthy()
    localStorage.setItem = original
    finishWorkout()
    expect(useStore.getState().S.active).toBeNull()
    expect(useStore.getState().S.workouts).toHaveLength(1)
    expect(useUI.getState().sheets).toHaveLength(1)
  })
  it('stopping a set cancels its callback, interval and visibility listener', () => {
    const done = vi.fn()
    useUI.getState().startWork(5, 'Hold', done)
    useUI.getState().stopWork()
    vi.advanceTimersByTime(10000)
    document.dispatchEvent(new Event('visibilitychange'))
    useUI.getState().finishWorkEarly()
    expect(useUI.getState().work).toBeNull()
    expect(done).not.toHaveBeenCalled()
  })
  it('finishing a workout cancels an unfinished timed set before clearing active', () => {
    useStore.getState().update(s => { s.active = workout() })
    const done = vi.fn(() => { throw new Error('stale callback') })
    useUI.getState().startWork(5, 'Hold', done)
    finishWorkout()
    expect(useStore.getState().S.active).toBeNull()
    expect(useStore.getState().S.workouts).toHaveLength(1)
    expect(useUI.getState().work).toBeNull()
    expect(() => vi.advanceTimersByTime(10000)).not.toThrow()
    expect(() => useUI.getState().finishWorkEarly()).not.toThrow()
    expect(done).not.toHaveBeenCalled()
  })
  it('discarding or replacing active cancels its work and rest timers', () => {
    useStore.getState().update(s => { s.active = workout() })
    const done = vi.fn()
    useUI.getState().startWork(5, 'Hold', done)
    useStore.getState().update(s => { s.active = null })
    expect(useUI.getState().work).toBeNull()
    vi.advanceTimersByTime(10000)
    expect(done).not.toHaveBeenCalled()
    useStore.getState().update(s => { s.active = workout() })
    useUI.getState().startRest(60)
    useStore.getState().update(s => { s.active = { ...workout(), id: 'different-session' } })
    expect(useUI.getState().timer).toBeNull()
  })
  it('starting another workout prevents an old timer from marking its sets', () => {
    useStore.getState().update(s => { s.active = workout() })
    const done = vi.fn()
    useUI.getState().startWork(5, 'Old hold', done)
    beginWorkout(null, null)
    expect(useStore.getState().S.active.id).not.toBe('session')
    expect(useUI.getState().work).toBeNull()
    vi.advanceTimersByTime(10000)
    expect(done).not.toHaveBeenCalled()
  })
  it('normal countdown and early completion still log exactly once', () => {
    const done = vi.fn()
    useUI.getState().startWork(5, 'Hold', done)
    vi.advanceTimersByTime(5000)
    expect(done).toHaveBeenCalledExactlyOnceWith(5)
    expect(useUI.getState().work).toBeNull()
    useUI.getState().finishWorkEarly()
    expect(done).toHaveBeenCalledTimes(1)
    const early = vi.fn()
    useUI.getState().startWork(10, 'Shorter hold', early)
    vi.advanceTimersByTime(3000)
    useUI.getState().finishWorkEarly()
    expect(early).toHaveBeenCalledExactlyOnceWith(3)
    vi.advanceTimersByTime(10000)
    expect(early).toHaveBeenCalledTimes(1)
  })
  it('edits within the same workout do not cancel a running hold', () => {
    useStore.getState().update(s => { s.active = workout() })
    const done = vi.fn()
    useUI.getState().startWork(5, 'Hold', done)
    useStore.getState().update(s => { s.active.cur = 1 })
    vi.advanceTimersByTime(5000)
    expect(done).toHaveBeenCalledExactlyOnceWith(5)
  })
})

describe('guided tours never interrupt training', () => {
  beforeEach(() => {
    localStorage.setItem('gym_guest', '1')
    useStore.setState({ ready: true, profileLoading: false })
  })
  it('starts and closes without editing the training profile or opening a sheet', () => {
    const before = useStore.getState().S
    expect(useUI.getState().startWalkthrough()).toBe(true)
    expect(useUI.getState().walkthrough.profile).toBe('guest')
    const id = useUI.getState().walkthrough.id
    expect(useUI.getState().startWalkthrough()).toBe(false)
    expect(useUI.getState().walkthrough.id).toBe(id)
    expect(useStore.getState().S).toBe(before)
    expect(useUI.getState().sheets).toHaveLength(0)
    useUI.getState().endWalkthrough()
    expect(useUI.getState().walkthrough).toBeNull()
    expect(useStore.getState().S).toBe(before)
  })
  it('does not offer a tour during an active workout', () => {
    useStore.getState().update(s => { s.active = workout() })
    const before = useStore.getState().S
    expect(useUI.getState().startWalkthrough()).toBe(false)
    expect(useUI.getState().toastMsg).toContain('Finish your workout')
    expect(useUI.getState().walkthrough).toBeNull()
    expect(useStore.getState().S).toBe(before)
  })
  it('queues return navigation metadata outside the profile and clears it on replay', () => {
    const before = useStore.getState().S
    useUI.getState().startWalkthrough()
    const destination = { url: '/settings', scroll: 240, focus: '[data-tour="tour-help"] button' }
    useUI.getState().endWalkthrough(destination)
    expect(useUI.getState().walkthroughReturn).toBe(destination)
    expect(useUI.getState().walkthrough).toBeNull()
    expect(useStore.getState().S).toBe(before)
    expect(useUI.getState().startWalkthrough()).toBe(true)
    expect(useUI.getState().walkthroughReturn).toBeNull()
    useUI.getState().endWalkthrough()
    expect(useUI.getState().walkthroughReturn).toBeNull()
  })
  it('leaves rest and work timers running when a tour is requested', () => {
    const done = vi.fn()
    useUI.getState().startWork(10, 'Hold', done)
    expect(useUI.getState().startWalkthrough()).toBe(false)
    expect(useUI.getState().work.label).toBe('Hold')
    vi.advanceTimersByTime(10000)
    expect(done).toHaveBeenCalledOnce()
    useUI.getState().startRest(60)
    expect(useUI.getState().startWalkthrough({ automatic: true })).toBe(false)
    expect(useUI.getState().timer.total).toBe(60)
    expect(useUI.getState().walkthrough).toBeNull()
  })
  it('leaves an open form and its unsaved inputs alone', () => {
    const { id } = useUI.getState().openSheet(() => null)
    expect(useUI.getState().startWalkthrough()).toBe(false)
    expect(useUI.getState().sheets[0].id).toBe(id)
    expect(useUI.getState().toastMsg).toContain('Close the open dialog')
  })
  it('waits for sign-in and profile loading to finish', () => {
    useStore.setState({ profileLoading: true })
    expect(useUI.getState().startWalkthrough()).toBe(false)
    useStore.setState({ profileLoading: false, ready: false })
    expect(useUI.getState().startWalkthrough()).toBe(false)
    useStore.setState({ ready: true })
    localStorage.removeItem('gym_guest')
    expect(useUI.getState().startWalkthrough()).toBe(false)
    useStore.setState({ user: { id: 'owner', admin: true } })
    expect(useUI.getState().startWalkthrough()).toBe(true)
    expect(useUI.getState().walkthrough.profile).toBe('owner')
  })
})
