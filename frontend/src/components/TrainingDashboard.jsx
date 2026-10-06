import { effectiveRoutine, effectiveRoutineId, streakWeeks, lastBW, setsDoneActive, modeOf, fmtSec } from '../lib/history.js'
import { fmtNum, fmtDate, isoOf, weekKey, DAYS, exCount } from '../lib/format.js'
import { t, dateLocale } from '../lib/i18n.js'
import { exOr } from '../lib/exercises.js'
import { APP_NAME } from '../lib/brand.js'
import Icon from './Icon.jsx'
import LineChart from './LineChart.jsx'
import { Button } from './ui.jsx'

// A compact target without hiding whether an exercise is timed or cardio.
export function sessionTarget(cfg) {
  const count = cfg.sets || 1
  const mode = modeOf(cfg)
  if (mode === 'time') return `${count} × ${fmtSec(cfg.sec || 45)}`
  if (mode === 'cardio') return `${count} × ${cfg.min || 20} min`
  return `${count} × ${cfg.reps || 10}`
}

// Presentational only: the app supplies its real state and existing actions. Keeping the
// dashboard separate also lets visual tests use synthetic data without touching a profile.
export default function TrainingDashboard({
  S, today = new Date(), weekOffset = 0, onWeekChange, onSettings, onDay, onCalendar,
  onSession, onRoutine, onExercise, onLogWeight, onGoal, onStarter, onBuildPlan,
  onCoach, coachOn = false, children
}) {
  const todayIso = isoOf(today)
  const scheduled = effectiveRoutine(S, todayIso)
  const active = S.active
  const routine = active ? S.routines.find(r => r.id === active.routineId) : scheduled
  const entries = active
    ? active.entries.map(e => ({ ...e.target, id: e.id, sets: e.sets.length,
      // Older sessions have no target. Read their actual sets, not today's routine.
      ...(e.target ? {} : { reps: e.sets[0]?.r, sec: e.sets[0]?.sec, min: e.sets[0]?.min,
        mode: e.sets[0]?.sec != null ? 'time' : e.sets[0]?.min != null ? 'cardio' : 'reps' }) }))
    : routine?.ex || []
  const empty = !S.routines.length && !active
  const rescheduled = !active && routine && S.dayPlan[todayIso] !== undefined
  const monday = new Date(today)
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7) + weekOffset * 7)
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(monday); date.setDate(monday.getDate() + i)
    return { date, iso: isoOf(date) }
  })
  const sunday = days[6].date
  const weekLabel = weekOffset === 0 ? t('This week')
    : `${monday.getDate()} ${monday.toLocaleDateString(dateLocale(), { month: 'short' })} – ${sunday.getDate()} ${sunday.toLocaleDateString(dateLocale(), { month: 'short' })}`
  const doneDays = new Set(S.workouts.map(w => w.d))
  const completed = S.workouts.filter(w => weekKey(w.d) === weekKey(isoOf(monday))).length
  const planned = days.filter(({ iso }) => effectiveRoutine(S, iso)?.ex.length > 0).length
  const bw = lastBW(S)
  const bwPoints = S.bodyweight.slice(-30).map(b => ({ t: b.t || +new Date(b.d + 'T12:00:00'), y: b.w, d: b.d }))
  const sessionName = active?.name || routine?.name || (empty ? t('Make it your own') : t('Rest day'))

  return <div className="narrow training-home">
    <header className="home-brand">
      <div><div className="home-wordmark">{APP_NAME}</div><div className="home-tagline">{t('Stronger days ahead')}</div></div>
      <button className="home-settings" onClick={onSettings} aria-label={t('Settings')}><Icon name="gear" /></button>
    </header>
    <div className="home-heading">
      <h1>{t('Your training')}</h1>
      <p>{today.toLocaleDateString(dateLocale(), { weekday: 'long' })}, {today.toLocaleDateString(dateLocale(), { day: 'numeric', month: 'long' })}</p>
    </div>
    <section className="home-week" data-tour="week" aria-label={t('Weekly training')}>
      <div className="home-week-summary">
        <div className="home-week-copy">
          <h2>{weekLabel}</h2>
          <p>{completed}{planned ? ' / ' + planned : ''} {t(completed === 1 && !planned ? 'workout' : 'workouts')}</p>
        </div>
        <button className="home-streak" onClick={onCalendar} aria-label={t('Open workout calendar')}>
          <Icon name="flame" /><span>{t('{0} week streak', streakWeeks(S, today))}</span>
        </button>
      </div>
      <div className="home-week-controls">
        <button onClick={() => onWeekChange(weekOffset - 1)} aria-label={t('Previous week')}><Icon name="chevronLeft" /></button>
        {weekOffset !== 0 && <button className="home-week-reset" onClick={() => onWeekChange(0)}>{t('This week')}</button>}
        <button onClick={() => onWeekChange(weekOffset + 1)} aria-label={t('Next week')}><Icon name="chevronRight" /></button>
      </div>
      <div className="home-days">
        {days.map(({ date, iso }) => {
          const done = doneDays.has(iso), plannedId = effectiveRoutineId(S, iso)
          const overridden = S.dayPlan[iso] !== undefined
          return <button key={iso} className={'home-day' + (iso === todayIso ? ' today' : '')}
            onClick={() => onDay(iso)} aria-current={iso === todayIso ? 'date' : undefined}
            aria-label={fmtDate(iso, true) + ' · ' + t(done ? 'Workout completed' : plannedId ? 'Workout planned' : 'Rest day')}>
            <span className="home-day-label">{t(DAYS[date.getDay()])}</span>
            <span className="home-day-number">{date.getDate()}</span>
            <span aria-hidden="true" className={'home-day-dot' + (done ? ' done' : overridden && plannedId ? ' rescheduled' : plannedId ? ' planned' : '')} />
          </button>
        })}
      </div>
    </section>
    <section className="home-session" data-tour="session" aria-labelledby="home-session-title">
      <div className="home-eyebrow">{t(active ? 'Workout in progress' : 'Today’s session')}</div>
      <h2 id="home-session-title">{sessionName}</h2>
      <p className="home-session-meta">{active || routine ? exCount(entries.length)
        : empty ? t('Start with a plan that fits you.') : t('A little recovery goes a long way.')}
        {active && <span> · {t(setsDoneActive(active) === 1 ? '{0} set done' : '{0} sets done', setsDoneActive(active))}</span>}
        {rescheduled && <span> · {t('rescheduled')}</span>}
      </p>
      {entries.length > 0 && <>
        <ol className="home-exercises">
          {entries.slice(0, 2).map((cfg, i) => {
            const exercise = exOr(cfg.id)
            return <li key={i}><button onClick={() => onExercise(exercise)} aria-label={t('View exercise: {0}', exercise.n)}>
              <span className="home-exercise-number" aria-hidden="true">{i + 1}</span>
              <span className="home-exercise-name">{exercise.n}</span>
              <span className="home-exercise-target">{sessionTarget(cfg)}</span>
              <Icon name="chevronRight" />
            </button></li>
          })}
        </ol>
        {entries.length > 2 && <button className="home-more" onClick={() => onRoutine(routine, active)}>
          {t(entries.length === 3 ? '+ {0} more exercise' : '+ {0} more exercises', entries.length - 2)}
        </button>}
      </>}
      {empty ? <div className="home-onboarding">
        <p>{t('Set up your weekly routine to get going — or load a ready-made Push / Pull / Legs plan.')}</p>
        <Button variant="neutral" onClick={coachOn ? onCoach : onStarter}>{t(coachOn ? 'Let the Coach build it' : 'Load starter plan (PPL)')}</Button>
        {coachOn && <Button onClick={onStarter}>{t('Load starter plan (PPL)')}</Button>}
        <Button onClick={onBuildPlan}>{t('Build my own plan')}</Button>
      </div> : <div className="home-session-actions">
        <Button variant="neutral" className="home-start" trailingIcon="arrowUp"
          onClick={() => !active && routine && !entries.length ? onRoutine(routine, active) : onSession()}>
          {t(active ? 'Resume workout' : entries.length ? 'Start workout' : routine ? 'Edit routine' : 'Choose workout')}
        </Button>
        <button className="home-routine" onClick={() => onRoutine(routine, active)}>
          <span>{t(active ? 'View workout' : routine ? 'View routine' : 'View plan')}</span><Icon name="chevronRight" />
        </button>
      </div>}
    </section>
    {children}
    <section className="home-bodyweight" data-tour="bodyweight" aria-labelledby="home-bodyweight-title">
      <div className="home-weight-heading">
        <div><h2 id="home-bodyweight-title">{t('Body weight')}</h2>
          {bw && <div className="home-weight-value">{fmtNum(bw.w)} <span>{S.unit}</span></div>}
        </div>
        <button className="home-log" onClick={onLogWeight}><Icon name="plus" />{t('Log')}</button>
      </div>
      {bw ? <>
        <div className="chart home-weight-chart" role="img" aria-label={t('Body weight trend. Latest: {0} {1}', fmtNum(bw.w), S.unit)}>
          <LineChart points={bwPoints} h={100} unit={S.unit} color="var(--chart-line)" quiet goal={S.targetW} />
        </div>
        <div className="home-weight-footer">
          <span>{fmtDate(bw.d, true)}</span>
          <button onClick={onGoal}>{S.targetW ? `${t('Goal')} ${fmtNum(S.targetW)} ${S.unit}` : t('Set a goal')}<Icon name="chevronRight" /></button>
        </div>
        {S.targetW && <p className="home-goal-note">{Math.abs(S.targetW - bw.w) < 0.05 ? t('Goal reached!')
          : t(S.targetW > bw.w ? '{0} to gain' : '{0} to lose', fmtNum(Math.abs(S.targetW - bw.w)) + ' ' + S.unit)}</p>}
      </> : <div className="home-weight-empty">
        <p>{t("No entries yet — log your weight to start the curve. It's also asked before every workout.")}</p>
        <button onClick={onGoal}>{S.targetW ? `${t('Goal')} ${fmtNum(S.targetW)} ${S.unit}` : t('Set a goal')}<Icon name="chevronRight" /></button>
      </div>}
    </section>
  </div>
}
