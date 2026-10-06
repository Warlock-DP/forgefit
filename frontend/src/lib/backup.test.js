import { describe, expect, it } from 'vitest'
import { parseBackup } from './backup.js'
import { buildDemoState } from './demoSeed.js'

const defaults = { workouts: [], routines: [], bodyweight: [], week: {}, dayPlan: {}, exWeights: {}, customEx: [], coach: null, unit: 'kg' }
const valid = () => ({ workouts: [{ id: 'w', d: '2026-10-05', entries: [{ id: 'plank', target: { id: 'plank', mode: 'time', sec: 45 }, sets: [{ sec: 45, w: 0, done: true }] }] }], routines: [{ id: 'r', name: 'Core', ex: [{ id: 'plank', mode: 'time', sec: 45, sets: 3 }] }] })

describe('backup import validation', () => {
  it('accepts a complete real demo export without losing training data', () => {
    const demo = buildDemoState()
    expect(parseBackup(JSON.stringify(demo), defaults).workouts).toEqual(demo.workouts)
    expect(parseBackup(demo, defaults).routines).toEqual(demo.routines)
  })
  it('fills absent legacy preferences and optional workout arrays', () => {
    const data = parseBackup({ workouts: [{ id: 'old', d: '2026-10-05' }], routines: [] }, defaults)
    expect(data).toMatchObject({ unit: 'kg', week: {}, bodyweight: [], workouts: [{ id: 'old', entries: [], prs: [] }] })
  })
  it('preserves timed sets, custom exercises, effort ratings and an active session', () => {
    const data = valid()
    data.customEx = [{ id: 'plank', n: 'Custom plank', bp: 'waist', custom: true }]
    data.workouts[0].entries[0].sets[0].rir = 0
    data.active = { ...data.workouts[0], start: 123, cur: 0 }
    const parsed = parseBackup(JSON.stringify(data), defaults)
    expect(parsed.routines[0].ex[0]).toMatchObject({ mode: 'time', sec: 45 })
    expect(parsed.workouts[0].entries[0].sets[0].rir).toBe(0)
    expect(parsed.active.entries[0].sets[0].sec).toBe(45)
    expect(parsed.customEx[0].n).toBe('Custom plank')
  })
  for (const [field, value] of [
    ['workouts', {}], ['routines', true], ['bodyweight', null], ['customEx', {}],
    ['week', []], ['dayPlan', 'Monday'], ['exWeights', []], ['reminder', false], ['coach', []], ['unit', {}],
  ]) it(`rejects an invalid ${field} before any replacement`, () => {
    const data = { ...valid(), [field]: value }
    expect(() => parseBackup(JSON.stringify(data), defaults)).toThrow('Invalid backup field')
  })
  it.each([
    { workouts: [null], routines: [] },
    { workouts: [{ id: 'w', d: '2026-02-30' }], routines: [] },
    { workouts: [{ id: 'w', d: '2026-10-05', entries: {} }], routines: [] },
    { workouts: [{ id: 'w', d: '2026-10-05', entries: [{ id: 'x', sets: [null] }] }], routines: [] },
    { workouts: [], routines: [{ id: 'r', ex: {} }] },
    { workouts: [], routines: [], coach: { log: {}, snapshots: [] } },
    { workouts: [], routines: [], coach: { profile: { equipment: true } } },
    { workouts: [], routines: [], coach: { snapshots: [{ routines: [], week: [] }] } },
  ])('rejects corrupt nested entries: %j', data => { expect(() => parseBackup(data, defaults)).toThrow('Invalid backup field') })
  it('never mutates the supplied data or defaults while validating/normalizing', () => {
    const original = valid(), before = JSON.stringify(original)
    const parsed = parseBackup(original, defaults)
    parsed.workouts[0].name = 'Changed'
    parsed.week[1] = 'r'
    expect(JSON.stringify(original)).toBe(before)
    expect(defaults.week).toEqual({})
  })
  it.each([undefined, null, '2026-10-05', Number.MAX_VALUE, 8640000000000001, -8640000000000001])('rejects a missing or unusable Coach history timestamp: %s', at => {
    const data = { workouts: [], routines: [], coach: { log: [{ id: 'history', at }], snapshots: [] } }
    expect(() => parseBackup(data, defaults)).toThrow('coach.log[0].at')
  })
  it('keeps valid Coach history dates and an empty legacy Coach history', () => {
    const data = { workouts: [], routines: [], coach: { log: [{ id: 'history', at: 1759708800000 }], snapshots: [] } }
    expect(parseBackup(data, defaults).coach.log[0].at).toBe(1759708800000)
    expect(parseBackup({ workouts: [], routines: [], coach: {} }, defaults).coach.log).toEqual([])
  })
  it('rejects prototype-injection keys in otherwise valid JSON', () => {
    expect(() => parseBackup('{"workouts":[],"routines":[],"__proto__":{"polluted":true}}', defaults)).toThrow('__proto__')
    expect({}.polluted).toBeUndefined()
  })
  it('rejects invalid JSON, non-backups and oversized files', () => {
    for (const raw of ['{', 'null', '[]', '{"opengym_plan":1,"routines":[]}']) expect(() => parseBackup(raw, defaults)).toThrow()
    expect(() => parseBackup(' '.repeat(5 * 1024 * 1024 + 1), defaults)).toThrow('5 MB')
  })
})
