import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { requestChat, JOB_ERRORS } from '../lib/coach-api.js'
import { Button, TextArea } from './ui.jsx'

export default function CoachChat({ config, demo, status, refresh, user }) {
  const nav = useNavigate()
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [queued, setQueued] = useState(null)
  const [shareChat, setShareChat] = useState(false)
  const ready = !demo && config?.coach?.enabled && config?.coach?.chat
  const send = async e => {
    e.preventDefault()
    if (!ready || !shareChat || sending || status.job || !text.trim()) return
    setSending(true); setError('')
    try { const result = await requestChat(text); setQueued({ id: result.job.id, text }); setText(''); await refresh() }
    catch (e) { setError(e.message || 'Could not send your message') }
    finally { setSending(false) }
  }
  const result = status.lastResult
  const finished = queued && result?.id === queued.id
  return <section className="card" aria-label="Workout planning chat">
    <h2 style={{ marginTop: 0 }}>Your planning coach</h2>
    <p className="muted small">{demo ? 'Demo — no AI connected. These examples are not AI responses.' : ready
      ? `OpenRouter · ${config.coach.model || 'free model'} · preview before saving`
      : config?.coach?.connected ? 'OpenRouter is connected but disabled. Enable it in Admin to chat.' : 'No AI connected. Configure and enable OpenRouter to start chatting.'}</p>
    {!ready && !demo && user?.admin && <Button onClick={() => nav('/admin')}>Configure OpenRouter</Button>}
    <Button size="sm" onClick={() => nav('/coach/intake?edit=1')}>Set equipment & goals</Button>
    <div role="log" aria-live="polite" style={{ maxHeight: 420, overflowY: 'auto' }}>
      {!(status.messages || []).length && <p className="muted">Tell me what you want to plan. Your saved equipment profile limits every exercise I can propose.</p>}
      {(status.messages || []).map((m, i) => <div key={i} style={{ padding: 12, margin: '10px 0', borderRadius: 12, background: m.role === 'user' ? 'var(--surface2)' : 'var(--surface)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
        <div className="dim small">{m.role === 'user' ? 'You' : `Coach${m.model ? ' · ' + m.model : ''}`}</div>{m.content}
      </div>)}
      {queued && !finished && <p>You: {queued.text}</p>}
    </div>
    {status.job && <p role="status">Coach is thinking…</p>}
    {result?.kind === 'chat' && result.outcome === 'failed' && <p role="alert">{JOB_ERRORS[result.errorClass] || 'The request failed.'} Nothing was applied. Please try again.</p>}
    {status.pending && <Button onClick={() => nav('/coach/proposal')}>Preview proposed plan</Button>}
    <form onSubmit={send} style={{ marginTop: 14 }}>
      {!demo && <label className="muted small" style={{ display: 'block', marginBottom: 12 }}><input type="checkbox" checked={shareChat} onChange={e => setShareChat(e.target.checked)} /> I agree to save my chat and share recent messages with OpenRouter for follow-ups.</label>}
      <TextArea aria-label="Message your planning coach" rows={3} maxLength={1000} value={text} onChange={e => setText(e.target.value)}
        placeholder="Plan five days with my dumbbells and pull-up bar, without a bench…" disabled={!ready || sending || !!status.job} />
      {error && <p role="alert">{error}</p>}
      <Button variant="primary" disabled={!ready || !shareChat || sending || !!status.job || !text.trim()} onClick={send}>Send message</Button>
    </form>
    {status.cap?.limit > 0 && <p className="dim small">{status.cap.used} of {status.cap.limit} daily Coach requests used.</p>}
    <p className="dim small">{demo ? 'Demo plans are generated locally. No messages are sent to an AI provider.' : 'Planning only. Chat history is saved to your account and shared with the model for follow-ups. Forgetting the Coach clears cloud chat. Free-tier request limits apply to each message.'}</p>
  </section>
}
