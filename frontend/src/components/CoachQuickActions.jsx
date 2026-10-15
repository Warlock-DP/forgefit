import { Button } from './ui.jsx'

export default function CoachQuickActions({ profile, consented, enabled, busy, pending, onProfile, onBuild, onPreview }) {
  return <section className="card" aria-label="Coach setup and planning">
    <h2 style={{ marginTop: 0 }}>Your workout coach</h2>
    <p className="muted small">Chat, set your equipment and goals, and preview a personalized plan before saving.</p>
    <div className="sect-b" style={{ marginBottom: 14 }}>
      <h3 style={{ margin: '0 0 6px' }}>Your profile</h3>
      <p className="muted small">{profile
        ? `${profile.daysPerWeek || '—'} days/week · ${profile.sessionMin || '—'} min · ${(profile.equipment || []).join(', ') || 'Equipment not set'}`
        : 'Start here: choose your goals, experience, equipment and available weights.'}</p>
      <Button icon="clipboard" onClick={onProfile}>{profile ? 'Edit equipment & goals' : 'Set up my profile'}</Button>
    </div>
    {pending
      ? <Button variant="primary" icon="sparkles" onClick={onPreview}>Preview proposed plan</Button>
      : <Button variant="primary" icon="sparkles" disabled={!consented || !enabled || busy || !profile} onClick={onBuild}>Build workout plan</Button>}
    <p className="dim small" role="status">{busy ? 'Coach is working on your request.'
      : !consented ? 'You can set up your profile now. Review AI data sharing below to unlock chat and plan generation.'
        : !enabled ? 'Connect and enable OpenRouter in Settings to generate a plan.'
          : !profile ? 'Save your profile first so every proposed exercise matches your equipment.'
            : 'Your existing plan stays unchanged until you approve a preview.'}</p>
  </section>
}
