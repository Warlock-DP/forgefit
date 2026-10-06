import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const exercise = { id: 'sample', st: ['English instructions'] }

beforeEach(() => vi.resetModules())
afterEach(() => {
  for (const path of ['../locales/fr.js', '../instr/fr.js', '../locales/es.js', '../instr/es.js', '../locales/de.js']) vi.doUnmock(path)
})

describe('latest-only language loading', () => {
  it('ignores a slow French UI pack after returning to English', async () => {
    const ui = deferred()
    vi.doMock('../locales/fr.js', () => ui.promise)
    vi.doMock('../instr/fr.js', () => ({ default: { sample: ['Instructions françaises'] } }))
    const i18n = await import('./i18n.js')
    await i18n.setLang('en')
    const french = i18n.setLang('fr')
    await i18n.setLang('en')
    ui.resolve({ default: { Home: 'Accueil' } })
    await french
    expect(i18n.getLang()).toBe('en')
    expect(i18n.dateLocale()).toBe('en-GB')
    expect(i18n.t('Home')).toBe('Home')
    expect(i18n.instrFor(exercise)).toEqual(exercise.st)
  })
  it('never publishes half-loaded packs and ignores late instructions after another language wins', async () => {
    const instructions = deferred()
    vi.doMock('../locales/fr.js', () => ({ default: { Home: 'Accueil' } }))
    vi.doMock('../instr/fr.js', () => instructions.promise)
    vi.doMock('../locales/es.js', () => ({ default: { Home: 'Inicio', 'Set {0}': 'Serie {0}' } }))
    vi.doMock('../instr/es.js', () => ({ default: { sample: ['Instrucciones españolas'] } }))
    const i18n = await import('./i18n.js')
    const french = i18n.setLang('fr')
    expect(i18n.getLang()).toBe('en')
    expect(i18n.t('Home')).toBe('Home')
    await i18n.setLang('es')
    instructions.resolve({ default: { sample: ['Instructions françaises'] } })
    await french
    expect(i18n.getLang()).toBe('es')
    expect(i18n.dateLocale()).toBe('es-ES')
    expect(i18n.t('Home')).toBe('Inicio')
    expect(i18n.t('Set {0}', 2)).toBe('Serie 2')
    expect(i18n.t('Fallback {0}', 3)).toBe('Fallback 3')
    expect(i18n.instrFor(exercise)).toEqual(['Instrucciones españolas'])
  })
  it('does not clear the new language when an obsolete import fails', async () => {
    const ui = deferred()
    vi.doMock('../locales/fr.js', () => ui.promise)
    vi.doMock('../instr/fr.js', () => ({ default: {} }))
    vi.doMock('../locales/de.js', () => ({ default: { Home: 'Startseite' } }))
    const i18n = await import('./i18n.js')
    const french = i18n.setLang('fr')
    await i18n.setLang('de')
    ui.reject(new Error('Pack unavailable'))
    await french
    expect(i18n.getLang()).toBe('de')
    expect(i18n.t('Home')).toBe('Startseite')
    expect(i18n.instrFor(exercise)).toEqual(exercise.st)
  })
  it('shares an in-progress request for the same language', async () => {
    const ui = deferred()
    vi.doMock('../locales/fr.js', () => ui.promise)
    vi.doMock('../instr/fr.js', () => ({ default: {} }))
    const i18n = await import('./i18n.js')
    const first = i18n.setLang('fr')
    const second = i18n.setLang('fr')
    expect(second).toBe(first)
    ui.resolve({ default: { Home: 'Accueil' } })
    await second
    expect(i18n.t('Home')).toBe('Accueil')
  })
  it('an invalid language cancels a pending switch and uses English', async () => {
    const ui = deferred()
    vi.doMock('../locales/fr.js', () => ui.promise)
    vi.doMock('../instr/fr.js', () => ({ default: {} }))
    const i18n = await import('./i18n.js')
    const french = i18n.setLang('fr')
    await i18n.setLang('invalid')
    ui.resolve({ default: { Home: 'Accueil' } })
    await french
    expect(i18n.getLang()).toBe('en')
    expect(i18n.t('Home')).toBe('Home')
  })
})
