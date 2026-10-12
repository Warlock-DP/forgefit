import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { effectiveRoutine } from '../lib/history.js'
import { todayISO } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { bwSheet, goalSheet, dayOverrideSheet, calendarSheet, startFlow, loadStarterPlan, exerciseDetailSheet } from '../sheets.jsx'
import TrainingDashboard from '../components/TrainingDashboard.jsx'
import Icon from '../components/Icon.jsx'
import { coachAvailable, hasConsent } from '../lib/coach.js'
import { useCoachStatus } from '../lib/coach-api.js'
import { DEMO } from '../lib/demo.js'
import { MOBILE } from '../lib/mobile.js'

// Only interrupt Home for a real job or a proposal awaiting review.
function CoachCard({ nav }) {
  const S = useStore(s => s.S)
  const { job, pending } = useCoachStatus(hasConsent(S))
  if (!hasConsent(S) || (!job && !pending)) return null
  const ready = !!pending
  return <button className="home-coach" onClick={() => nav(ready ? '/coach/proposal' : '/coach')}>
    <Icon name="sparkles" />
    <span><span className="home-eyebrow">{t('Coach')}</span><span className="home-coach-title">{ready
      ? (pending.kind === 'create' ? t('Your plan is ready')
        : t(pending.changes?.length === 1 ? '{0} suggestion for you' : '{0} suggestions for you', pending.changes?.length || 0))
      : t('Reading your training…')}</span></span>
    <Icon name="chevronRight" />
  </button>
}

export default function Home() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const config = useStore(s => s.config)
  const [weekOffset, setWeekOffset] = useState(0)
  const coachOn = coachAvailable(config, user, { demo: DEMO, mobile: MOBILE })
  const onSession = () => {
    if (S.active) { nav('/workout'); return }
    const routine = effectiveRoutine(S, todayISO())
    if (routine?.ex.length) startFlow(routine.id)
    else dayOverrideSheet(todayISO())
  }
  return <TrainingDashboard S={S} weekOffset={weekOffset} onWeekChange={setWeekOffset}
    onSettings={() => nav('/settings')} onDay={dayOverrideSheet} onCalendar={calendarSheet}
    onSession={onSession} onRoutine={(routine, active) => nav(active ? '/workout' : routine ? '/plan/r/' + routine.id : '/plan')}
    onExercise={exerciseDetailSheet} onLogWeight={() => bwSheet()} onGoal={goalSheet}
    onStarter={loadStarterPlan} onBuildPlan={() => nav('/plan')} coachOn={coachOn}
    onCoach={() => nav(hasConsent(S) ? '/coach/intake' : '/coach')}>
    {coachOn && <CoachCard nav={nav} />}
  </TrainingDashboard>
}
