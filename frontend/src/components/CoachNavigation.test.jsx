import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { WorkoutTabBar } from './TabBar.jsx'
import CoachQuickActions from './CoachQuickActions.jsx'
vi.mock('../store/useStore.js', () => ({ useStore: vi.fn() }))

const noop = () => {}
const render = props => renderToStaticMarkup(<CoachQuickActions onProfile={noop} onBuild={noop} onPreview={noop} {...props} />)

describe('discoverable Coach navigation', () => {
  it('keeps all existing destinations and highlights Coach on nested routes', () => {
    const html = renderToStaticMarkup(<WorkoutTabBar current="coach" showCoach onNavigate={noop} onStart={noop} />)
    for (const label of ['Home', 'Plan', 'Start', 'Coach', 'Stats', 'Exercises']) expect(html).toContain(`<span>${label}</span>`)
    expect(html).toMatch(/aria-current="page"[^>]*>.*?<span>Coach<\/span>/)
    expect(html.match(/aria-current="page"/g)).toHaveLength(1)
  })
  it('does not advertise Coach when unavailable', () => {
    expect(renderToStaticMarkup(<WorkoutTabBar current="home" onNavigate={noop} onStart={noop} />)).not.toContain('<span>Coach</span>')
  })
  it('makes profile setup visible before consent without enabling generation', () => {
    const html = render({ enabled: true })
    expect(html).toContain('Set up my profile')
    expect(html).toContain('Review AI data sharing')
    expect(html).toMatch(/disabled=""[^>]*>.*?Build workout plan/)
  })
  it('shows saved equipment and enables planning after consent', () => {
    const html = render({ profile: { daysPerWeek: 5, sessionMin: 60, equipment: ['dumbbell', 'pull-up bar'] }, consented: true, enabled: true })
    expect(html).toContain('5 days/week · 60 min · dumbbell, pull-up bar')
    expect(html).toContain('Edit equipment &amp; goals')
    expect(html).not.toContain('disabled=""')
  })
  it('prioritizes a pending preview over duplicate generation', () => {
    const html = render({ pending: true })
    expect(html).toContain('Preview proposed plan')
    expect(html).not.toContain('Build workout plan')
  })
})
