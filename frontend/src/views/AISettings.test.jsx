import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { AISettingsAccess, OpenRouterSettingsEntry } from './AISettings.jsx'
import { CoachConfiguration, ApiKeySheet } from './AdminCoach.jsx'

// Keep these UI tests independent of browser storage, personal profiles and real AI calls.
vi.mock('../store/useStore.js', () => ({ useStore: Object.assign(
  selector => selector({ user: null, config: null }),
  { getState: () => ({ refreshConfig: async () => ({}) }) }
) }))
vi.mock('../store/useUI.js', () => ({ useUI: selector => selector({ toast: vi.fn(), openSheet: vi.fn() }) }))
vi.mock('../lib/api.js', () => ({ api: vi.fn() }))
vi.mock('../lib/mobile.js', () => ({ MOBILE: false }))

const render = renderToStaticMarkup
const owner = { id: 'owner', admin: true }
const member = { id: 'member', admin: false }
const noop = () => {}
const details = patch => ({
  enabled: false, provider: 'openrouter', disabledByEnv: false,
  providers: [{ id: 'openrouter', label: 'OpenRouter (free only)', apiKey: true, freeOnly: true, defaultModel: 'openrouter/free' }],
  runtime: { ok: true }, auth: { state: 'disconnected' }, model: null,
  caps: { perProfileDaily: 5, instanceDaily: 20 },
  hardCaps: { perProfileDaily: 5, instanceDaily: 20, requestsDaily: 40 },
  jobsToday: 0, recent: [], ...patch
})
const panel = (patch, busy = false) => render(<CoachConfiguration d={details(patch)} busy={busy}
  patch={noop} test={noop} disconnect={noop} load={noop} openSheet={noop} />)
const gated = props => render(<AISettingsAccess onAccount={noop} {...props}><div>private-provider-controls</div></AISettingsAccess>)

describe('discoverable OpenRouter setup', () => {
  it('shows a clickable Settings entry even for guests and an unconfigured Coach', () => {
    const html = render(<OpenRouterSettingsEntry user={null} onOpen={noop} />)
    expect(html).toContain('AI &amp; OpenRouter')
    expect(html).toContain('Configure OpenRouter')
    expect(html).toContain('owner sign-in required')
    expect(html).toContain('<button')
  })

  it('shows owner-specific setup controls in the entry description', () => {
    expect(render(<OpenRouterSettingsEntry user={owner} onOpen={noop} />)).toContain('API key, free model, connection test')
  })

  it('asks guests to sign in without rendering private controls', () => {
    const html = gated({ user: null })
    expect(html).toContain('Owner sign-in required')
    expect(html).toContain('Go to Account settings')
    expect(html).toContain('private owner setup code')
    expect(html).not.toContain('private-provider-controls')
  })

  it('does not let a non-admin profile configure the shared provider key', () => {
    const html = gated({ user: member, onCoach: noop })
    expect(html).toContain('Only the app owner')
    expect(html).toContain('Open the Coach')
    expect(html).not.toContain('private-provider-controls')
  })

  it('renders provider controls only for the owner', () => {
    expect(gated({ user: owner })).toContain('private-provider-controls')
  })

  it('does not configure cloud credentials in an offline build', () => {
    const html = gated({ user: owner, offline: true })
    expect(html).toContain('Cloud app required')
    expect(html).not.toContain('private-provider-controls')
  })
})

describe('OpenRouter configuration controls', () => {
  it('allows adding a key and choosing a model before enabling the Coach', () => {
    const html = panel()
    expect(html).toContain('Coach is off')
    expect(html).toContain('Add API key')
    expect(html).toContain('OpenRouter free model')
    expect(html).toContain('openrouter/free')
    expect(html).toContain('aria-label="Enable AI Coach"')
    expect(html).toContain('aria-checked="false"')
  })

  it('offers connection testing, key replacement and disconnect without displaying a saved key', () => {
    const html = panel({ auth: { state: 'connected', credential: 'never-render-this-secret' } })
    expect(html).toContain('Test connection')
    expect(html).toContain('Replace API key')
    expect(html).toContain('Disconnect')
    expect(html).not.toContain('never-render-this-secret')
  })

  it('keeps paid models blocked and explains the hard request ceilings', () => {
    const html = panel()
    expect(html).toContain('Paid models and paid fallbacks are blocked')
    expect(html).toContain(':free')
    expect(html).toContain('40 API requests')
    expect(html).toContain('max="5"')
    expect(html).toContain('max="20"')
  })

  it('disables the model field while a settings mutation is running', () => {
    expect(panel({}, true)).toMatch(/aria-label="OpenRouter free model" disabled=""/)
  })

  it('honors a host-level force-disable', () => {
    const html = panel({ disabledByEnv: true })
    expect(html).toContain('COACH_DISABLED')
    expect(html).not.toContain('Add API key')
  })

  it('uses a private password field and explains the synthetic save-and-test request', () => {
    const html = render(<ApiKeySheet label="OpenRouter (free only)" freeOnly close={noop} onDone={noop} />)
    expect(html).toContain('type="password"')
    expect(html).toContain('autoComplete="off"')
    expect(html).toContain('maxLength="512"')
    expect(html).toContain('value=""')
    expect(html).toContain('Save key and test')
    expect(html).toContain('without any of your workout data')
    expect(html).toContain('https://openrouter.ai/keys')
    expect(html).toContain('never returned to the browser')
  })
})
