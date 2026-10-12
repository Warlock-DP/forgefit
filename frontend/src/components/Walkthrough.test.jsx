import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { WalkthroughCard } from './Walkthrough.jsx'
import { walkthroughSteps } from '../lib/walkthrough.js'
import { setLang, t } from '../lib/i18n.js'

vi.mock('../store/useStore.js', () => ({ useStore: vi.fn() }))
vi.mock('../store/useUI.js', () => ({ useUI: vi.fn() }))

const render = index => {
  const steps = walkthroughSteps()
  return renderToStaticMarkup(<WalkthroughCard step={steps[index]} index={index} total={steps.length} />)
}
afterEach(() => setLang('en'))
describe('walkthrough controls and read-only teaching', () => {
  it('offers an immediate Skip, clear progress, and Start without a Back dead end', () => {
    const html = render(0)
    expect(html).toContain('Skip tour'); expect(html).toContain('Let’s explore')
    expect(html).toContain('aria-valuenow="1"'); expect(html).toContain('tabindex="-1"')
    expect(html).not.toContain('>Back</button>')
    expect(html).toContain('read-only tour')
  })
  it('teaches a logged set with no editable fields or live workout actions', () => {
    const html = render(7)
    expect(html).toContain('Read-only example of a logged set'); expect(html).toContain('20 × 10')
    expect(html).toContain('>Back</button>'); expect(html).toContain('Next')
    expect(html).not.toContain('<input'); expect(html).not.toContain('onchange')
    expect((html.match(/<button/g) || []).length).toBe(3)
  })
  it('ends with a Home action and explains how to replay', () => {
    const html = render(15)
    expect(html).toContain('Back to Home'); expect(html).toContain('Settings → Help → App walkthrough')
    expect(html).toContain('aria-valuenow="16"')
  })
  it('renders the copy, controls and accessible labels in the selected language', async () => {
    await setLang('fr')
    const welcome = render(0)
    expect(welcome).toContain('Bienvenue dans ForgeFit')
    expect(welcome).toContain('Vous êtes chez vous.')
    expect(welcome).toContain('Passer la visite')
    expect(welcome).toContain('Progression de la visite')
    expect(welcome).toContain('Environ 3 minutes')
    expect(welcome).toContain('Découvrir')
    expect(welcome).not.toContain('Skip tour')
    expect(welcome).not.toContain('Make yourself at home.')
    const workout = render(7)
    expect(workout).toContain('Exemple en lecture seule')
    expect(workout).toContain('Charge × répétitions')
    expect(workout).toContain('Série 1')
    expect(workout).toContain('Retour')
    expect(workout).toContain('Suiv.')
    expect(workout).not.toContain('<input')
    expect(render(15)).toContain('Retour à l’accueil')
    expect(t('Help')).toBe('Aide')
    expect(t('App walkthrough')).toBe('Visite de l’application')
    expect(t('Finish your workout before starting the walkthrough.')).toBe('Terminez votre séance avant de démarrer la visite.')
  })
})
