import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from './api.js'
import { useStore } from '../store/useStore.js'
import { forgetCoach, requestPlan, requestReview, refinePlan, syncCoachProfile } from './coach-api.js'

vi.mock('./api.js', () => ({ api: vi.fn() }))
vi.mock('./demo.js', () => ({ DEMO: false }))
vi.mock('../store/useStore.js', () => ({ useStore: { getState: vi.fn() } }))
let state
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }

beforeEach(() => {
  vi.clearAllMocks()
  state = { user: { id: 'member' }, syncError: '', S: { workouts: [{ id: 'kept' }], coach: { consent: { version: 1, agreedAt: '2026-10-05T12:00:00Z' }, cadence: { everyWorkouts: 4 }, log: [{ id: 'history' }] } }, pushState: vi.fn().mockResolvedValue(true) }
  state.update = fn => fn(state.S)
  useStore.getState.mockImplementation(() => state)
  api.mockResolvedValue({ job: { id: 'fake-job' } })
})

describe('Coach sync prerequisites', () => {
  for (const [action, argument, path, body] of [
    [requestReview, 'a note', '/api/coach/review', { note: 'a note' }],
    [requestPlan, { goal: 'strength' }, '/api/coach/plan', { intake: { goal: 'strength' } }],
    [refinePlan, 'more core', '/api/coach/plan', { refine: 'more core' }],
  ]) it(`flushes consent/intake before ${Object.keys(body)[0]} requests`, async () => {
    const save = deferred()
    state.pushState.mockReturnValue(save.promise)
    const request = action(argument)
    expect(state.pushState).toHaveBeenCalledOnce()
    expect(api).not.toHaveBeenCalled()
    save.resolve(true)
    await request
    expect(api).toHaveBeenCalledWith(path, { method: 'POST', body: JSON.stringify(body) })
  })
  it('does not call AI when syncing is offline or conflicted', async () => {
    state.pushState.mockResolvedValue(false)
    state.syncError = 'Resolve the sync conflict first'
    await expect(requestReview()).rejects.toThrow('sync conflict')
    expect(api).not.toHaveBeenCalled()
  })
  it('does not call AI after the server normalizes revoked backup consent', async () => {
    state.pushState.mockImplementation(async () => { state.S.coach.consent = null; return true })
    await expect(requestReview()).rejects.toMatchObject({ code: 'consent' })
    expect(api).not.toHaveBeenCalled()
  })
  it('does not flush or submit an AI request when the intake could not be saved to device storage', async () => {
    state.storageError = 'Device save failed'
    await expect(requestPlan({})).rejects.toThrow('Device save failed')
    expect(state.pushState).not.toHaveBeenCalled()
    expect(api).not.toHaveBeenCalled()
  })
  it('never claims a Coach shutdown succeeded when its local save was rejected', async () => {
    state.update = vi.fn(() => false)
    state.storageError = 'Device save failed'
    await expect(forgetCoach()).rejects.toThrow('Device save failed')
    expect(state.S.coach.consent).toBeTruthy()
    expect(state.pushState).not.toHaveBeenCalled()
  })
  it('does not send a request for a profile changed during the save', async () => {
    state.pushState.mockImplementation(async () => { state.user = { id: 'other' }; return true })
    await expect(requestPlan({})).rejects.toThrow('profile changed')
    expect(api).not.toHaveBeenCalled()
  })
  it('requires a signed-in profile, never uses guest data', async () => {
    state.user = null
    await expect(syncCoachProfile()).rejects.toThrow('Sign in')
    expect(state.pushState).not.toHaveBeenCalled()
    expect(api).not.toHaveBeenCalled()
  })
  it('turns the Coach off with one versioned save, preserving workout and Coach history', async () => {
    await forgetCoach()
    expect(state.S.coach).toMatchObject({ consent: null, cadence: 'off', log: [{ id: 'history' }] })
    expect(state.S.workouts).toEqual([{ id: 'kept' }])
    expect(state.pushState).toHaveBeenCalledOnce()
    expect(api).not.toHaveBeenCalled()
  })
  it('reports an offline shutdown honestly and keeps the local withdrawal pending', async () => {
    state.pushState.mockResolvedValue(false)
    await expect(forgetCoach()).rejects.toThrow('cloud shutdown is not confirmed')
    expect(state.S.coach.consent).toBeNull()
    expect(api).not.toHaveBeenCalled()
  })
})
