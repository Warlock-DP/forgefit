import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import SyncNotice, { SyncSettings } from './SyncNotice.jsx'
import { useStore } from '../store/useStore.js'

vi.mock('../store/useStore.js', () => ({ useStore: vi.fn() }))
vi.mock('../store/useUI.js', () => ({ useUI: selector => selector({ toast: () => {} }) }))
vi.mock('../sheets.jsx', () => ({ confirmSheet: vi.fn() }))
afterEach(() => vi.clearAllMocks())
const state = patch => ({ user: { id: 'member' }, syncStatus: 'synced', syncError: '', recoveryCopies: [],
  pullState: vi.fn(), resolveSyncConflict: vi.fn(), ...patch })
const render = (Component, patch) => {
  const current = state(patch)
  useStore.mockImplementation(selector => selector ? selector(current) : current)
  return renderToStaticMarkup(<MemoryRouter><Component /></MemoryRouter>)
}
describe('sync recovery controls', () => {
  it('does not show a banner when sync is healthy or in guest mode', () => {
    expect(render(SyncNotice, {})).toBe('')
    expect(render(SyncNotice, { user: null, syncStatus: 'error' })).toBe('')
  })
  it('makes failed saves and conflicts visible instead of silently failing', () => {
    const html = render(SyncNotice, { syncStatus: 'conflict', syncError: 'Your local changes are safe.' })
    expect(html).toContain('role="alert"')
    expect(html).toContain('Your local changes are safe.')
    expect(html).toContain('Review sync in Settings')
  })
  it.each([null, { id: 'member' }])('shows a truthful storage failure for both guests and signed-in profiles: %j', user => {
    const html = render(SyncNotice, { user, syncStatus: 'error', storageError: 'Export a backup, then retry the change.' })
    expect(html).toContain('role="alert"')
    expect(html).toContain('Device save failed')
    expect(html).toContain('Export a backup, then retry the change.')
    expect(html).toContain('Open backup settings')
    expect(html).not.toContain('Changes saved on this device')
  })
  it('offers both explicit choices for a conflicting profile, not a blind retry', () => {
    const html = render(SyncSettings, { syncStatus: 'conflict' })
    expect(html).toContain('Use cloud copy')
    expect(html).toContain('Use this device’s copy')
    expect(html).not.toContain('Sync now')
  })
  it('exposes guest recovery backups without requiring an account', () => {
    const html = render(SyncSettings, { user: null, recoveryCopies: [{ at: 1000, reason: 'Guest copy', state: { workouts: [{ id: 'guest' }] } }] })
    expect(html).toContain('Guest copy')
    expect(html).toContain('Download recovery backup')
    expect(html).not.toContain('Cloud sync')
  })
})
