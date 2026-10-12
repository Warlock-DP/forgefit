import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { DEMO } from '../lib/demo.js'
import { MOBILE } from '../lib/mobile.js'
import { t } from '../lib/i18n.js'
import Icon from '../components/Icon.jsx'
import { Button, Section, Row } from '../components/ui.jsx'
import AdminCoach from './AdminCoach.jsx'

export function OpenRouterSettingsEntry({ user, onOpen }) {
  return <Section title={t('AI & OpenRouter')}
    footer={t('The app owner manages the provider key. Each profile chooses separately whether to share workout data with AI.')}>
    <Row icon="key" iconTint="var(--acc)" title={t('Configure OpenRouter')}
      subtitle={user?.admin ? t('API key, free model, connection test and AI controls')
        : t('Free-model AI Coach · owner sign-in required for setup')}
      accessory="chevron" onClick={onOpen} />
  </Section>
}

// This entry point is public to guests; credentials and provider changes are not.
// The same owner-only endpoints used by the admin dashboard enforce access again.
export function AISettingsAccess({ user, offline, onAccount, onCoach, children }) {
  if (offline) return <div className="card">
    <h2>{t('Cloud app required')}</h2>
    <p className="muted small">{t('OpenRouter setup is available in the hosted ForgeFit app, not in the offline mobile or demo build.')}</p>
  </div>

  if (user?.admin) return children

  return <div className="card">
    <h2>{t('Owner sign-in required')}</h2>
    <p className="muted small" style={{ lineHeight: 1.5 }}>
      {user ? t('Only the app owner can add or replace the shared OpenRouter key. Ask the owner to configure it; your workout data stays private until you opt in.')
        : t('Sign in with your owner passkey to configure OpenRouter. If this is your first profile, create it using your private owner setup code in Account settings.')}
    </p>
    {!user && <Button variant="primary" icon="personCircle" onClick={onAccount}>{t('Go to Account settings')}</Button>}
    {user && onCoach && <Button variant="primary" icon="sparkles" onClick={onCoach}>{t('Open the Coach')}</Button>}
  </div>
}

export default function AISettings() {
  const nav = useNavigate()
  const user = useStore(s => s.user)
  const config = useStore(s => s.config)

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/settings')} aria-label={t('Settings')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 8 }}>
        <h1>{t('OpenRouter & AI')}</h1>
        <div className="sub">{t('Free models. Your control.')}</div>
      </div>
    </div>
    <div className="card" data-tour="ai-setup">
      <h2>{t('Configure AI inside ForgeFit')}</h2>
      <p className="muted small" style={{ lineHeight: 1.5 }}>
        {t('Add your OpenRouter API key, choose a free model, test the connection, then enable the AI Coach. No Netlify environment-variable changes are needed for the provider key.')}
      </p>
      <p className="dim small" style={{ lineHeight: 1.5 }}>
        {t('The key is stored encrypted on the backend, never in workout backups or browser storage. Enabling AI does not automatically share workouts: each profile must give consent first.')}
      </p>
      <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer">{t('Get an OpenRouter API key')} ↗</a>
    </div>
    <AISettingsAccess user={user} offline={DEMO || MOBILE} onAccount={() => nav('/settings')}
      onCoach={config?.coach?.enabled ? () => nav('/coach') : undefined}>
      <AdminCoach />
    </AISettingsAccess>
  </div>
}
