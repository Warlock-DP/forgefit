import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('owner setup code input capacity', () => {
  for (const view of ['Login.jsx', 'Settings.jsx']) {
    it(`${view} accepts a complete 64-character owner setup code`, () => {
      const source = readFileSync(new URL(view, import.meta.url), 'utf8')
      const field = source.match(/placeholder=\{t\('Invite code'\)\} maxLength=\{(\d+)\}/)
      expect(field).not.toBeNull()
      expect(Number(field[1])).toBeGreaterThanOrEqual(64)
      // Profile-name limits should remain independent of credential limits.
      expect(source).toMatch(/placeholder=\{t\('Your name'\)\} maxLength=\{40\}/)
    })
  }
})
