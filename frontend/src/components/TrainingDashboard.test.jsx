import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import TrainingDashboard, { sessionTarget } from './TrainingDashboard.jsx'
import { WorkoutTabBar } from './TabBar.jsx'
import LineChart from './LineChart.jsx'
import { registerCustom } from '../lib/exercises.js'
import { reviewDate, reviewExercises, reviewState } from '../../tests/design-fixture.js'

vi.mock('../store/useStore.js', () => ({ useStore: vi.fn() }))
afterEach(() => registerCustom([]))
const noop = () => {}
const render = (patch = {}, props = {}) => {
  registerCustom(reviewExercises)
  return renderToStaticMarkup(<TrainingDashboard S={{ ...reviewState(), ...patch }} today={reviewDate}
    onWeekChange={noop} onSettings={noop} onDay={noop} onCalendar={noop} onSession={noop}
    onRoutine={noop} onExercise={noop} onLogWeight={noop} onGoal={noop} onStarter={noop}
    onBuildPlan={noop} onCoach={noop} {...props} />)
}

describe('real-data training dashboard', () => {
  it('renders the selected hierarchy with actual plan and history values', () => {
    const html = render()
    for (const text of ['ForgeFit', 'Stronger days ahead', 'Your training', 'Sunday, 4 October',
      '3 / 4 workouts', '4 week streak', 'Push day', '6 exercises', 'Bench press', '3 × 8–10',
      '+ 4 more exercises', 'Start workout', 'View routine', 'Body weight', '75.2']) expect(html).toContain(text)
    expect(html).not.toContain('today-row')
  })

  it('makes all seven calendar days buttons and marks only today', () => {
    const html = render()
    expect((html.match(/class="home-day[ "]/g) || []).length).toBe(7)
    expect((html.match(/aria-current="date"/g) || []).length).toBe(1)
    expect(html).toContain('Sun 4 Oct · Workout planned')
    expect(html).toContain('Mon 28 Sept · Workout completed')
  })

  it('updates the completed count for the displayed previous week', () => {
    const html = render({}, { weekOffset: -1 })
    expect(html).toContain('21 Sept – 27 Sept')
    expect(html).toContain('1 / 4 workouts')
    expect(html).not.toContain('aria-current="date"')
  })

  it('counts date-specific rest and rescheduled overrides in the weekly plan', () => {
    expect(render({ dayPlan: { '2026-09-28': 'rest' } })).toContain('3 / 3 workouts')
    expect(render({ dayPlan: { '2026-09-29': 'review-push' } })).toContain('3 / 5 workouts')
  })

  it('does not show a fake routine, chart, or completion streak for a new profile', () => {
    const html = render({ routines: [], week: {}, workouts: [], bodyweight: [] })
    expect(html).toContain('Make it your own')
    expect(html).toContain('Load starter plan (PPL)')
    expect(html).toContain('Build my own plan')
    expect(html).toContain('0 week streak')
    expect(html).not.toContain('Push day')
    expect(html).not.toContain('<polyline')
    expect(html).not.toContain('75.2')
    expect(html).not.toContain('Let the Coach build it')
  })

  it('keeps the optional AI onboarding action gated by availability', () => {
    expect(render({ routines: [], week: {} }, { coachOn: true })).toContain('Let the Coach build it')
  })

  it('keeps rest-day selection and access to the plan', () => {
    const html = render({ dayPlan: { '2026-10-04': 'rest' } })
    expect(html).toContain('Rest day')
    expect(html).toContain('Choose workout')
    expect(html).toContain('View plan')
    expect(html).not.toContain('Start workout')
  })

  it('uses the active workout rather than the scheduled routine', () => {
    const html = render({ active: { name: 'My active session', routineId: 'deleted', entries: [
      { id: 'review-bench', target: { reps: 6 }, sets: [{ r: 6, done: true }, { r: 6, done: false }] }
    ] } })
    for (const text of ['My active session', 'Workout in progress', '1 exercise', '1 set done', '2 × 6',
      'Resume workout', 'View workout']) expect(html).toContain(text)
    expect(html).not.toContain('Push day')
    expect(html).not.toContain('Start workout')
  })

  it('handles freestyle and old timed sessions even without a matching routine', () => {
    const html = render({ routines: [], active: { name: 'Freestyle', entries: [
      { id: 'review-bench', sets: [{ sec: 90, done: false }] }
    ] } })
    expect(html).toContain('1 × 1:30')
    expect(html).toContain('Resume workout')
    expect(html).not.toContain('Load starter plan')
  })

  it('offers editing instead of starting an empty routine', () => {
    const html = render({ routines: [{ id: 'review-push', name: 'Empty plan', ex: [] }] })
    expect(html).toContain('0 exercises')
    expect(html).toContain('Edit routine')
    expect(html).not.toContain('Start workout')
  })

  it('does not hide deleted exercise IDs', () => {
    const html = render({ routines: [{ id: 'review-push', name: 'Imported', ex: [{ id: 'does-not-exist', sets: 2, reps: 8 }] }] })
    expect(html).toContain('Unknown exercise')
    expect(html).toContain('2 × 8')
  })

  it('retains goal controls and respects the profile unit and latest recorded weight', () => {
    const html = render({ unit: 'lb', targetW: 170, bodyweight: [{ d: '2026-10-03', w: 175 }] })
    expect(html).toContain('175')
    expect(html).toContain('Goal 170 lb')
    expect(html).toContain('5 lb to lose')
    expect(html).toContain('Body weight trend. Latest: 175 lb')
  })

  it('shows a goal reached state without a misleading negative zero', () => {
    expect(render({ targetW: 75.2 })).toContain('Goal reached!')
  })

  it('preserves long routine names and escapes custom text', () => {
    const name = 'My very long workout <script> & recovery routine'
    const html = render({ routines: [{ id: 'review-push', name, ex: [] }] })
    expect(html).toContain('My very long workout &lt;script&gt; &amp; recovery routine')
    expect(html).not.toContain('<script>')
  })
})

describe('exercise target modes', () => {
  it('formats reps, duration and cardio without rewriting the stored target', () => {
    expect(sessionTarget({ sets: 3, reps: 8 })).toBe('3 × 8')
    expect(sessionTarget({ sets: 2, mode: 'time', sec: 90 })).toBe('2 × 1:30')
    expect(sessionTarget({ sets: 1, mode: 'cardio', min: 20 })).toBe('1 × 20 min')
  })
})

describe('quiet data chart', () => {
  const points = [{ t: +new Date('2026-09-28T12:00:00'), y: 76 }, { t: +reviewDate, y: 75.2 }]
  it('keeps the existing chart style by default', () => {
    const html = renderToStaticMarkup(<LineChart points={points} />)
    expect(html).toContain('<polygon')
    expect(html).toContain('linearGradient')
    expect(html).toContain('stroke-width="2.5"')
  })
  it('uses a real grey data line, orange endpoint, and no area fill in quiet mode', () => {
    const html = renderToStaticMarkup(<LineChart points={points} quiet color="var(--chart-line)" />)
    expect(html).toContain('stroke="var(--chart-line)"')
    expect(html).toContain('fill="var(--acc)"')
    expect(html).not.toContain('<polygon')
    expect(html).not.toContain('linearGradient')
  })
})

describe('flat accessible navigation', () => {
  const nav = (current, active = null) => renderToStaticMarkup(<WorkoutTabBar current={current} active={active} onNavigate={noop} onStart={noop} />)
  it('renders five equal navigation controls without the raised disc', () => {
    const html = nav('home')
    expect((html.match(/<button/g) || []).length).toBe(5)
    expect(html).toContain('Main navigation')
    expect(html).toContain('aria-current="page"')
    expect(html).not.toContain('class="cir"')
  })
  it('marks workout and history correctly and switches Start to Resume', () => {
    expect(nav('workout', { entries: [] })).toContain('class="on rec"')
    expect(nav('workout', { entries: [] })).toContain('Resume')
    expect(nav('history')).toMatch(/aria-current="page"[^>]*>.*?<span>Stats<\/span>/)
  })
})
