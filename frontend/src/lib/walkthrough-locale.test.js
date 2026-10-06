import { describe, expect, it } from 'vitest'
import { LANGS } from './i18n.js'
import { walkthroughSteps } from './walkthrough.js'
import { makeWalkthroughLocale, walkthroughLocaleKeys } from './walkthrough-locale.js'

const packs = import.meta.glob('../locales/*.js', { eager: true, import: 'default' })
const modes = [{}, { user: { id: 'member' }, coach: true }, { user: { admin: true }, coach: true },
  { mobile: true }, { demo: true, coach: true }]

describe('complete walkthrough translations', () => {
  for (const lang of Object.keys(LANGS).filter(lang => lang !== 'en')) {
    it(`${lang} translates every step, capability variant, control and Help message`, () => {
      const dict = packs['../locales/' + lang + '.js']
      const keys = new Set(walkthroughLocaleKeys)
      for (const options of modes) {
        for (const step of walkthroughSteps(options)) {
          for (const field of ['eyebrow', 'title', 'body', 'tip', 'next']) if (step[field]) {
            expect(keys.has(step[field]), step.id + '.' + field).toBe(true)
          }
        }
      }
      for (const key of keys) {
        expect(typeof dict[key], key).toBe('string')
        expect(dict[key].trim(), key).not.toBe('')
        // "Set" is also the Turkish word; it is legitimately unchanged.
        if (lang !== 'tr' || key !== 'Set {0}') expect(dict[key], key).not.toBe(key)
        expect(dict[key].match(/\{\d+\}/g) || [], key).toEqual(key.match(/\{\d+\}/g) || [])
      }
    })
  }
  it('rejects incomplete step translations rather than silently using English', () => {
    expect(() => makeWalkthroughLocale({})).toThrow('Invalid walkthrough translation: welcome')
  })
})
