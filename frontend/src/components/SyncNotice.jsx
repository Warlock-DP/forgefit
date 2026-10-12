import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { confirmSheet } from '../sheets.jsx'
import { t } from '../lib/i18n.js'
import { Button, Section } from './ui.jsx'

export default function SyncNotice() {
  const user = useStore(s => s.user)
  const status = useStore(s => s.syncStatus)
  const error = useStore(s => s.syncError)
  const storageError = useStore(s => s.storageError)
  const nav = useNavigate()
  if (!storageError && (!user || !['error', 'conflict'].includes(status))) return null
  return <div className="narrow" role="alert" style={{ paddingTop: 12 }}>
    <div className="card" style={{ padding: 16 }}>
      <div className="tt">{t(storageError ? 'Device save failed' : status === 'conflict' ? 'Cloud sync needs your attention' : 'Changes saved on this device')}</div>
      <p className="small muted">{t(storageError || error)}</p>
      <Button onClick={() => nav('/settings')}>{t(storageError ? 'Open backup settings' : 'Review sync in Settings')}</Button>
    </div>
  </div>
}

const labels = {
  idle: 'Cloud sync', pending: 'Waiting to sync', syncing: 'Saving to cloud…',
  synced: 'Cloud copy is up to date', error: 'Cloud save failed', conflict: 'Two different copies found',
}

export function SyncSettings() {
  const { user, syncStatus, syncError, recoveryCopies, pullState, resolveSyncConflict } = useStore()
  const toast = useUI(s => s.toast)
  const [busy, setBusy] = useState(false)
  const run = async action => {
    setBusy(true)
    try {
      const saved = await action()
      toast(t(saved ? 'Cloud sync complete' : 'Not synced yet — your device copy is safe.'))
    } catch (error) { toast(error.message) }
    finally { setBusy(false) }
  }
  const choose = choice => confirmSheet({
    title: t(choice === 'cloud' ? 'Use the cloud copy?' : 'Use this device’s copy?'),
    message: t(choice === 'cloud'
      ? 'Replaces this device’s saved history with the latest cloud history. The device copy is kept as a downloadable recovery backup. Your active workout stays on this device.'
      : 'Replaces the cloud history with this device’s history. The previous cloud copy is kept as a downloadable recovery backup. Other devices will need to review the change.'),
    confirmText: t(choice === 'cloud' ? 'Use cloud copy' : 'Use device copy'),
    danger: true, onConfirm: () => {
      if (useStore.getState().user?.id !== user.id) { toast(t('The signed-in profile changed. Review its sync status first.')); return }
      return run(() => resolveSyncConflict(choice))
    },
  })
  const download = copy => {
    const blob = new Blob([JSON.stringify(copy.state, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `forgefit-recovery-${new Date(copy.at).toISOString().replace(/[:.]/g, '-')}.json`
    link.click()
    URL.revokeObjectURL(url)
    toast(t('Backup exported'))
  }
  if (!user && !recoveryCopies.length) return null
  return <>
    {user && <Section title={t('Cloud sync')}>
      <div style={{ padding: 16 }} aria-live="polite">
        <div className="tt">{t(labels[syncStatus] || labels.idle)}</div>
        <p className="small muted">{t(syncError || 'Your changes are saved on this device first, then synced to your profile.')}</p>
        {syncStatus === 'conflict' ? <>
          <Button disabled={busy} onClick={() => choose('cloud')}>{t('Use cloud copy')}</Button>
          <div style={{ height: 8 }} />
          <Button disabled={busy} onClick={() => choose('local')}>{t('Use this device’s copy')}</Button>
        </> : <Button disabled={busy || syncStatus === 'syncing'} onClick={() => run(pullState)}>{t('Sync now')}</Button>}
      </div>
    </Section>}
    {!!recoveryCopies.length && <Section title={t('Recovery backups')}
      footer={t('Kept only on this device. Download a copy, then use Import backup below if you need to restore it.')}>
      {[...recoveryCopies].reverse().map((copy, index) => <div key={`${copy.at}-${index}`} style={{ padding: 16 }}>
        <div className="tt">{t(copy.reason)}</div>
        <p className="small muted">{new Date(copy.at).toLocaleString()} · {t('{0} workouts', copy.state.workouts?.length || 0)}</p>
        <Button onClick={() => download(copy)}>{t('Download recovery backup')}</Button>
      </div>)}
    </Section>}
  </>
}
