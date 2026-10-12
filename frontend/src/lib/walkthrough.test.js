import { beforeEach, describe, expect, it, vi } from 'vitest'
import { canOfferWalkthrough, walkthroughSteps, walkthroughPlacement, resolveWalkthroughStep } from './walkthrough.js'

describe('guided tour coverage and privacy', () => {
  it('covers every main app area without requiring existing training', () => {
    const steps = walkthroughSteps()
    expect(steps.map(s => s.id)).toEqual(['welcome', 'navigation', 'week', 'session', 'bodyweight', 'plan', 'routine', 'workout', 'finish', 'library', 'stats', 'history', 'settings', 'data', 'ai', 'done'])
    for (const step of steps) {
      expect(step.title).toBeTruthy(); expect(step.body).toBeTruthy(); expect(step.tip).toBeTruthy()
      expect(step.route.startsWith('/')).toBe(true)
    }
    expect(steps.find(s => s.id === 'routine').route).toBe('/plan')
    expect(steps.find(s => s.id === 'data').body).toContain('guest mode')
    expect(steps.find(s => s.id === 'ai').body).toContain('Only the app owner')
  })
  it('visits an existing routine without creating one', () => {
    expect(walkthroughSteps({ routineId: 'my routine' }).find(s => s.id === 'routine').route).toBe('/plan/r/my%20routine')
    expect(walkthroughSteps({ user: { id: 'member' } }).find(s => s.id === 'data').body).toContain('signed-in profile')
  })
  it('falls back safely when a routine disappears during the tour', () => {
    const step = walkthroughSteps({ routineId: 'removed' }).find(s => s.id === 'routine')
    expect(resolveWalkthroughStep(step, [{ id: 'removed' }])).toBe(step)
    expect(resolveWalkthroughStep(step, []).route).toBe('/plan')
    expect(resolveWalkthroughStep(step, []).target).toBe('[data-tour="routines"]')
    expect(step.route).toBe('/plan/r/removed')
  })
  it('shows Coach and admin screens only when available', () => {
    const member = walkthroughSteps({ user: { id: 'member' }, coach: true })
    expect(member.some(s => s.id === 'coach')).toBe(true)
    expect(member.some(s => s.id === 'admin')).toBe(false)
    const owner = walkthroughSteps({ user: { id: 'owner', admin: true }, coach: true })
    expect(owner.find(s => s.id === 'ai').body).toContain('encrypted on the server')
    expect(owner.at(-2).id).toBe('admin')
    expect(owner.at(-1).id).toBe('done')
  })
  it('does not advertise cloud setup as working in offline builds', () => {
    for (const mode of [{ mobile: true }, { demo: true }]) {
      const steps = walkthroughSteps({ ...mode, user: { admin: true } })
      expect(steps.some(s => s.route === '/admin' || s.route === '/settings/ai')).toBe(false)
      expect(steps.find(s => s.id === 'data').body).toContain('on this device')
      expect(steps.find(s => s.id === 'ai').body).toContain(mode.demo ? 'simulated' : 'no cloud AI setup')
    }
    expect(walkthroughSteps({ demo: true, coach: true }).find(s => s.id === 'coach').body).toContain('simulates')
  })
})

describe('non-interrupting first-visit invitation', () => {
  const eligible = { ready: true, authed: true, pathname: '/home' }
  it('offers once on a ready, idle Home screen', () => {
    expect(canOfferWalkthrough(eligible)).toBe(true)
    for (const patch of [{ ready: false }, { profileLoading: true }, { authed: false }, { active: {} }, { sheets: 1 }, { timer: {} }, { work: {} }, { touring: {} }, { pathname: '/workout' }, { seen: true }]) {
      expect(canOfferWalkthrough({ ...eligible, ...patch })).toBe(false)
    }
  })
})

describe('responsive tour card placement', () => {
  const card = { width: 420, height: 440 }
  it('centres the introduction and uses available space beside a target', () => {
    expect(walkthroughPlacement(null, { width: 1440, height: 900 }, card)).toEqual({ left: 510, top: 230 })
    expect(walkthroughPlacement({ left: 100, right: 600, top: 150, bottom: 250, height: 100 }, { width: 1440, height: 900 }, card)).toEqual({ left: 618, top: 16 })
  })
  it('places the navigation explanation above a bottom tab bar', () => {
    const position = walkthroughPlacement({ left: 0, right: 390, top: 766, bottom: 844, height: 78 }, { width: 390, height: 844 }, card)
    expect(position.top + card.height).toBeLessThan(766)
  })
  it('keeps the controls in the viewport at phone, desktop, and landscape sizes', () => {
    for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 1440, height: 900 }, { width: 667, height: 375 }]) {
      for (const target of [null, { left: 20, right: 700, top: 200, bottom: 800, height: 600 }]) {
        const p = walkthroughPlacement(target, viewport, card)
        expect(p.left).toBeGreaterThanOrEqual(16); expect(p.top).toBeGreaterThanOrEqual(16)
        expect(p.left + Math.min(card.width, viewport.width - 32)).toBeLessThanOrEqual(viewport.width - 16)
        expect(p.top + Math.min(card.height, viewport.height - 32)).toBeLessThanOrEqual(viewport.height - 16)
      }
    }
  })
})

describe('device-only seen metadata', () => {
  beforeEach(() => vi.resetModules())
  it('writes a single onboarding flag and no workout state', async () => {
    const { walkthroughSeen, markWalkthroughSeen, WALKTHROUGH_KEY } = await import('./walkthrough.js')
    const storage = { getItem: vi.fn(() => null), setItem: vi.fn() }
    expect(walkthroughSeen(storage)).toBe(false)
    markWalkthroughSeen(storage)
    expect(storage.setItem).toHaveBeenCalledExactlyOnceWith(WALKTHROUGH_KEY, 'seen')
    expect(walkthroughSeen(storage)).toBe(true)
  })
  it('remembers dismissal in memory when browser storage is blocked or full', async () => {
    const { walkthroughSeen, markWalkthroughSeen } = await import('./walkthrough.js')
    const storage = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('full') } }
    expect(walkthroughSeen(storage)).toBe(false)
    expect(() => markWalkthroughSeen(storage)).not.toThrow()
    expect(walkthroughSeen(storage)).toBe(true)
  })
})
