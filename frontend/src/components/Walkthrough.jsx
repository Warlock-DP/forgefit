import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { DEMO } from '../lib/demo.js'
import { MOBILE } from '../lib/mobile.js'
import { coachAvailable } from '../lib/coach.js'
import { t, useLang } from '../lib/i18n.js'
import { canOfferWalkthrough, markWalkthroughSeen, walkthroughSeen, walkthroughSteps, walkthroughPlacement, resolveWalkthroughStep } from '../lib/walkthrough.js'
import Icon from './Icon.jsx'

export function WalkthroughCard({ step, index, total, onBack, onNext, onClose, titleRef, style, cardRef }) {
  useLang()
  return <section className="tour-card" ref={cardRef} style={style}>
    <div className="tour-topline">
      <span className="tour-count" role="status" aria-live="polite">{index + 1} / {total}</span>
      <button type="button" className="tour-skip" onClick={onClose}>{t('Skip tour')} <Icon name="xmark" /></button>
    </div>
    <div className="tour-progress" role="progressbar" aria-label={t('Walkthrough progress')} aria-valuemin={1} aria-valuemax={total} aria-valuenow={index + 1}>
      <span style={{ width: ((index + 1) / total * 100) + '%' }} />
    </div>
    <div className="tour-copy">
      <span className="tour-icon"><Icon name={step.icon} /></span>
      <p className="tour-eyebrow">{t(step.eyebrow)}</p>
      <h2 id="tour-title" ref={titleRef} tabIndex={-1}>{t(step.title)}</h2>
      <p id="tour-description" className="tour-description">{t(step.body)}</p>
      {step.sample && <div className="tour-example" aria-label={t('Read-only example of a logged set')}>
        <div><span>{t('Example only')}</span><span>{t('Set {0}', 1)}</span></div>
        <div><span>{t('Weight × reps')}</span><strong>20 × 10 <Icon name="checkCircle" /></strong></div>
        <small>{t('Enter your numbers, then mark the set done.')}</small>
      </div>}
      <p className="tour-tip"><Icon name="lightbulb" /><span>{t(step.tip)}</span></p>
    </div>
    <div className="tour-actions">
      {index > 0 ? <button type="button" className="btn tour-back" onClick={onBack}><Icon name="chevronLeft" />{t('Back')}</button>
        : <span className="tour-duration">{t('About 3 minutes')}</span>}
      <button type="button" className="btn primary tour-next" onClick={onNext}>{t(step.next || 'Next')}<Icon name={index === total - 1 ? 'check' : 'chevronRight'} /></button>
    </div>
  </section>
}

function TourSession({ session }) {
  const loc = useLocation(), nav = useNavigate()
  const dialogRef = useRef(null), cardRef = useRef(null), titleRef = useRef(null)
  const maskId = useId().replace(/:/g, '')
  const [origin] = useState(() => ({ url: loc.pathname + loc.search + loc.hash, scroll: window.scrollY }))
  const [steps] = useState(() => {
    const { S, user, config } = useStore.getState()
    return walkthroughSteps({ user, demo: DEMO, mobile: MOBILE, coach: coachAvailable(config, user, { demo: DEMO, mobile: MOBILE }), routineId: S.routines[0]?.id })
  })
  const [index, setIndex] = useState(0)
  const [layout, setLayout] = useState(null)
  const routines = useStore(s => s.S.routines)
  const step = useMemo(() => resolveWalkthroughStep(steps[index], routines), [steps, index, routines])
  const closing = useRef(false)

  const close = (finished = false) => {
    if (closing.current) return
    closing.current = true
    markWalkthroughSeen()
    dialogRef.current?.close()
    const url = finished ? '/home' : origin.url
    useUI.getState().endWalkthrough({ url, scroll: finished ? 0 : origin.scroll,
      focus: !finished && origin.url === '/settings' ? '[data-tour="tour-help"] button' : '#tabbar button[aria-current="page"]' })
    nav(url, { replace: true })
  }

  useEffect(() => {
    const dialog = dialogRef.current
    const previouslyFocused = document.activeElement
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    if (!dialog.open) dialog.showModal()
    titleRef.current?.focus({ preventScroll: true })
    // Background controls are inert while the native modal is open, including the
    // still-mounted Start button. No background action is ever invoked by the tour.
    return () => {
      if (dialog.open) dialog.close()
      document.body.style.overflow = overflow
      if (previouslyFocused?.isConnected) previouslyFocused.focus({ preventScroll: true })
    }
  }, [])

  useEffect(() => {
    if (loc.pathname !== step.route) nav(step.route, { replace: true })
  }, [step.route, nav, loc.pathname])

  useLayoutEffect(() => {
    if (loc.pathname !== step.route) { setLayout(null); return }
    let frame, startFrame, target
    const measure = () => {
      const width = window.innerWidth, height = window.innerHeight
      const card = cardRef.current?.getBoundingClientRect()
      const rect = target?.getBoundingClientRect()
      const highlight = rect && rect.width && rect.height ? {
        left: Math.max(8, rect.left - 6), top: Math.max(8, rect.top - 6),
        right: Math.min(width - 8, rect.right + 6), bottom: Math.min(height - 8, rect.bottom + 6),
      } : null
      if (highlight) { highlight.width = highlight.right - highlight.left; highlight.height = highlight.bottom - highlight.top }
      setLayout({ width, height, highlight: highlight?.width > 0 && highlight?.height > 0 ? highlight : null,
        ...walkthroughPlacement(highlight, { width, height }, { width: card?.width || 400, height: card?.height || 400 }) })
    }
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure) }
    const observer = new ResizeObserver(schedule)
    if (cardRef.current) observer.observe(cardRef.current)
    startFrame = requestAnimationFrame(() => {
      target = step.target ? document.querySelector(step.target) : null
      if (target) {
        observer.observe(target)
        // The navigation rail is fixed; scrolling it would unnecessarily move Home.
        if (step.target !== '#tabbar') {
          const rect = target.getBoundingClientRect()
          window.scrollTo({ top: window.scrollY + rect.top - 28, behavior: 'instant' })
        }
      } else window.scrollTo({ top: 0, behavior: 'instant' })
      cardRef.current?.querySelector('.tour-copy')?.scrollTo(0, 0)
      titleRef.current?.focus({ preventScroll: true })
      measure()
    })
    window.addEventListener('resize', schedule)
    window.addEventListener('scroll', schedule, { passive: true })
    return () => {
      cancelAnimationFrame(frame); cancelAnimationFrame(startFrame); observer.disconnect()
      window.removeEventListener('resize', schedule); window.removeEventListener('scroll', schedule)
    }
  }, [index, step, loc.pathname])

  useEffect(() => useStore.subscribe(state => {
    if (state.S.active || (state.user?.id || 'guest') !== session.profile || !state.ready || state.profileLoading
      || (steps.some(s => s.id === 'admin') && !state.user?.admin)
      || (steps.some(s => s.id === 'coach') && !coachAvailable(state.config, state.user, { demo: DEMO, mobile: MOBILE }))) {
      // An external profile/workout change closes the tour without restoring a route
      // that may belong to somebody else. It never stops or discards the workout.
      useUI.getState().endWalkthrough()
    }
  }), [session.profile, steps])

  const h = layout?.highlight
  return <dialog ref={dialogRef} className="tour-dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-description"
    onKeyDown={event => {
      if (event.key !== 'Tab') return
      const buttons = [...cardRef.current.querySelectorAll('button:not([disabled])')]
      const focused = buttons.indexOf(document.activeElement)
      if (event.shiftKey && focused <= 0) {
        event.preventDefault(); buttons.at(-1)?.focus()
      } else if (!event.shiftKey && (focused === buttons.length - 1 || focused < 0)) {
        event.preventDefault(); buttons[0]?.focus()
      }
    }}
    onCancel={event => { event.preventDefault(); close() }}>
    <svg className="tour-shade" aria-hidden="true" width="100%" height="100%">
      <defs><mask id={maskId}><rect width="100%" height="100%" fill="white" />
        {h && <rect x={h.left} y={h.top} width={h.width} height={h.height} rx="16" fill="black" />}
      </mask></defs>
      <rect width="100%" height="100%" fill="rgba(0,0,0,.62)" mask={`url(#${maskId})`} />
      {h && <rect x={h.left} y={h.top} width={h.width} height={h.height} rx="16" className="tour-outline" />}
    </svg>
    <WalkthroughCard step={step} index={index} total={steps.length} cardRef={cardRef} titleRef={titleRef}
      style={layout ? { left: layout.left, top: layout.top } : undefined}
      onClose={() => close()} onBack={() => setIndex(i => Math.max(0, i - 1))}
      onNext={() => index === steps.length - 1 ? close(true) : setIndex(i => i + 1)} />
  </dialog>
}

export default function Walkthrough() {
  const loc = useLocation()
  const { ready, profileLoading, user, S, isGuest } = useStore()
  const { walkthrough, walkthroughReturn, sheets, timer, work, startWalkthrough } = useUI()
  useEffect(() => {
    // Router navigation may be deferred. Restore only after the destination has
    // actually mounted, not on a guessed timeout that might still see the old page.
    if (walkthrough || !walkthroughReturn || loc.pathname + loc.search + loc.hash !== walkthroughReturn.url) return
    window.scrollTo({ top: walkthroughReturn.scroll, behavior: 'instant' })
    document.querySelector(walkthroughReturn.focus)?.focus({ preventScroll: true })
    useUI.setState({ walkthroughReturn: null })
  }, [walkthrough, walkthroughReturn, loc.pathname, loc.search, loc.hash])
  useEffect(() => {
    if (walkthrough && (S.active || !ready || profileLoading || !(user || isGuest()) || (user?.id || 'guest') !== walkthrough.profile)) {
      useUI.getState().endWalkthrough()
      return
    }
    if (canOfferWalkthrough({ ready, profileLoading, authed: !!(user || isGuest()), active: S.active,
      sheets: sheets.length, timer, work, touring: walkthrough, pathname: loc.pathname, seen: walkthroughSeen() })) {
      startWalkthrough({ automatic: true })
    }
  }, [ready, profileLoading, user, S.active, isGuest, sheets.length, timer, work, walkthrough, loc.pathname, startWalkthrough])
  return walkthrough ? <TourSession key={walkthrough.id} session={walkthrough} /> : null
}
