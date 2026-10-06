import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { LogCard } from './Coach.jsx'
import { fmtTimestamp } from '../lib/format.js'

vi.mock('../store/useStore.js', () => ({ useStore: vi.fn(), DEF: {} }))
vi.mock('../store/useUI.js', () => ({ useUI: selector => selector({ openSheet: vi.fn() }) }))
vi.mock('../sheets.jsx', () => ({ confirmSheet: vi.fn() }))
vi.mock('../lib/coach-api.js', () => ({ useCoachStatus: vi.fn(), requestReview: vi.fn(), resolvePending: vi.fn(), forgetCoach: vi.fn(), syncCoachProfile: vi.fn(), disclosure: vi.fn(), JOB_ERRORS: {} }))

describe('Coach history with damaged cached dates', () => {
  it.each([undefined, null, 'bad-date', Number.MAX_VALUE, NaN, Infinity])('renders old malformed entries without crashing: %s', at => {
    const html = renderToStaticMarkup(<LogCard coach={{ log: [{ id: 'cached', kind: 'review', at }] }} />)
    expect(html).toContain('Coach history')
    expect(html).toContain('Reviewed your training')
    expect(html).toContain('Date unavailable')
    expect(fmtTimestamp(at, true)).toBe('Date unavailable')
  })
  it('still formats real history dates, including an epoch-zero timestamp', () => {
    expect(fmtTimestamp(Date.parse('2026-10-05T12:00:00Z'))).toBe('5 Oct')
    expect(fmtTimestamp(0)).toBe('1 Jan')
    const html = renderToStaticMarkup(<LogCard coach={{ log: [{ id: 'real', kind: 'create', at: Date.parse('2026-10-05T12:00:00Z') }] }} />)
    expect(html).toContain('Built a plan')
    expect(html).toContain('5 Oct')
    expect(html).not.toContain('Date unavailable')
  })
})
