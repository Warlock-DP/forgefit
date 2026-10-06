import { useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { effectiveRoutine } from '../lib/history.js'
import { todayISO } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import Icon from './Icon.jsx'

export function WorkoutTabBar({ current, active, onNavigate, onStart }) {
  const on = k => current === k || (current === 'history' && k === 'stats') || (current === 'settings' && k === 'home')
  const Tab = ({ k, icon, to, label }) => (
    <button className={on(k) ? 'on' : ''} onClick={() => onNavigate(to)} aria-current={on(k) ? 'page' : undefined}>
      <Icon name={icon} /><span>{label}</span><i className="tab-indicator" aria-hidden="true" />
    </button>
  )
  return <nav id="tabbar" aria-label={t('Main navigation')}>
    <Tab k="home" icon="house" to="/home" label={t('Home')} />
    <Tab k="plan" icon="calendar" to="/plan" label={t('Plan')} />
    <button className={(on('workout') ? 'on ' : '') + (active ? 'rec' : '')} onClick={onStart}
      aria-current={on('workout') ? 'page' : undefined}>
      <Icon name="play" /><span>{t(active ? 'Resume' : 'Start')}</span><i className="tab-indicator" aria-hidden="true" />
    </button>
    <Tab k="stats" icon="chart" to="/stats" label={t('Stats')} />
    <Tab k="library" icon="dumbbell" to="/library" label={t('Exercises')} />
  </nav>
}

export default function TabBar({ onStart }) {
  const nav = useNavigate()
  const loc = useLocation()
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const isGuest = useStore(s => s.isGuest())
  if (!user && !isGuest) return null
  const cur = loc.pathname.split('/')[1] || 'home'

  const startWorkout = () => {
    if (!S.active) {
      const r = effectiveRoutine(S, todayISO())
      if (r && r.ex.length) { onStart(r.id); return }
    }
    nav('/workout')
  }
  return <WorkoutTabBar current={cur} active={S.active} onNavigate={nav} onStart={startWorkout} />
}
