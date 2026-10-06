// Talking to the Coach endpoints, and knowing when to stop.
//
// Jobs are minutes-scale, so the client polls. The one rule worth stating: polling only runs
// while a Coach surface is on screen or a job is known to be in flight. An app that pings the
// server every thirty seconds forever because a feature exists is an app that costs battery
// for a feature nobody is using.

import { useEffect, useState, useCallback, useRef } from 'react'
import { api } from './api.js'
import { DEMO } from './demo.js'
import { CONSENT_VERSION } from './coach.js'
import { useStore } from '../store/useStore.js'

const POLL_MS = 3000        // a job is running: often enough to feel live
const IDLE_MS = 60000       // a Coach screen is open but nothing is running

// The demo build has no backend, so it answers these locally with a canned proposal built
// from its own seeded profile (lib/coach-demo.js). Everything downstream — validation,
// staleness, apply, revert, the log — runs unchanged; only the provider is faked. The module
// is imported dynamically so none of it lands in a self-hosted bundle.
let demoMod = null
const demo = async () => (demoMod = demoMod || await import('./coach-demo.js'))
const S = () => useStore.getState().S

// Consent and intake edits must reach the authoritative profile before a job reads it.
// A debounce is fine for ordinary settings, but never a prerequisite for an AI request.
export async function syncCoachProfile() {
  if (DEMO) return
  const store = useStore.getState(), uid = store.user?.id
  if (!uid) throw new Error('Sign in before using the Coach.')
  if (store.storageError) throw new Error(store.storageError)
  if (!await store.pushState()) throw new Error(useStore.getState().syncError || 'Save your profile before asking the Coach. Check cloud sync in Settings.')
  if (useStore.getState().user?.id !== uid) throw new Error('The profile changed. Open the Coach again for the current profile.')
}
const ask = async (path, body) => {
  await syncCoachProfile()
  const consent = S().coach?.consent
  if (!consent?.agreedAt || consent.version !== CONSENT_VERSION) throw Object.assign(new Error('The Coach needs your go-ahead first. Open Coach and accept the disclosure again.'), { code: 'consent' })
  return api(path, { method: 'POST', body: JSON.stringify(body) })
}

export const coachStatus = async () => DEMO ? (await demo()).demoStatus() : api('/api/coach/status')
export const requestReview = async note => DEMO ? (await demo()).demoReview(S()) : ask('/api/coach/review', { note: note || '' })
export const requestPlan = async intake => DEMO ? (await demo()).demoPlan(S(), intake) : ask('/api/coach/plan', { intake })
export const refinePlan = async text => DEMO ? (await demo()).demoRefine(S()) : ask('/api/coach/plan', { refine: text })
export const resolvePending = async body => DEMO ? (await demo()).demoResolve() : api('/api/coach/pending/resolve', { method: 'POST', body: JSON.stringify(body) })
export const forgetCoach = async () => {
  if (useStore.getState().update(s => { if (s.coach) s.coach = { ...s.coach, consent: null, cadence: 'off' } }) === false) throw new Error(useStore.getState().storageError || 'Could not save the Coach shutdown. Try again before closing the app.')
  // The versioned state save revokes consent and removes held jobs in the same transaction.
  // A separate /forget write would invalidate the base revision and race the state save.
  if (DEMO) return (await demo()).demoResolve()
  try { await syncCoachProfile() }
  catch (error) { throw new Error('The Coach is off on this device, but cloud shutdown is not confirmed: ' + error.message) }
}
export const disclosure = async () => DEMO ? (await demo()).demoDisclosure() : api('/api/coach/disclosure')

/**
 * Live job/proposal state.
 *
 * `active` lets a caller (the Home card) subscribe only while it is mounted and visible;
 * everything else keeps the poll off. Errors are swallowed on purpose — a Coach status call
 * failing while you are mid-workout is not something to interrupt anyone about.
 */
export function useCoachStatus(active = true) {
  const [state, setState] = useState({ job: null, pending: null, cap: null, loading: true })
  const timer = useRef(null)

  const refresh = useCallback(async () => {
    try {
      const s = await coachStatus()
      setState({ ...s, loading: false })
      return s
    } catch {
      setState(s => ({ ...s, loading: false }))
      return null
    }
  }, [])

  useEffect(() => {
    if (!active) return
    let stopped = false
    const tick = async () => {
      const s = await refresh()
      if (stopped) return
      timer.current = setTimeout(tick, s?.job ? POLL_MS : IDLE_MS)
    }
    tick()
    return () => { stopped = true; clearTimeout(timer.current) }
  }, [active, refresh])

  return { ...state, refresh }
}

// Server failure classes, in the app's voice. The provider's own words go to the admin card;
// what a lifter needs is what it means for them and whether trying again will help.
export const JOB_ERRORS = {
  off: 'The Coach isn’t set up on this instance.',
  busy: 'The Coach is already thinking about your training.',
  cap: 'The Coach is resting — try again tomorrow.',
  consent: 'The Coach needs your go-ahead first.',
  timeout: 'The Coach took too long and gave up.',
  auth: 'The Coach couldn’t sign in to its provider — the instance owner needs to check its setup.',
  missing: 'The Coach isn’t installed properly on this instance.',
  provider: 'The Coach couldn’t run — the instance owner needs to check its setup.',
  unusable: 'The Coach answered with something the app couldn’t use.',
  restart: 'The server restarted while the Coach was thinking.',
  nostate: 'The Coach couldn’t read your training data.',
  internal: 'Something went wrong on the server.'
}
