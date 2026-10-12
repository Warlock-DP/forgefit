// Device-only onboarding metadata. It is deliberately outside the workout/profile store,
// so taking (or skipping) a tour never marks a plan dirty or gets included in a backup.
export const WALKTHROUGH_KEY = 'forgefit_walkthrough_v1'
let seenInMemory = false

export function walkthroughSeen(storage) {
  try { return seenInMemory || (storage || globalThis.localStorage)?.getItem(WALKTHROUGH_KEY) === 'seen' }
  catch { return seenInMemory }
}

export function markWalkthroughSeen(storage) {
  seenInMemory = true
  try { (storage || globalThis.localStorage)?.setItem(WALKTHROUGH_KEY, 'seen') }
  catch { /* A full/private browser must not prevent closing the tour. */ }
}

export function canOfferWalkthrough({ ready, profileLoading, authed, active, sheets, timer, work, touring, pathname, seen }) {
  return !!(ready && !profileLoading && authed && !active && !sheets && !timer && !work && !touring && pathname === '/home' && !seen)
}

export function walkthroughSteps({ user, demo = false, mobile = false, coach = false, routineId } = {}) {
  const offline = demo || mobile
  const steps = [
    { id: 'welcome', route: '/home', icon: 'dumbbell', eyebrow: 'Welcome to ForgeFit', title: 'Make yourself at home.',
      body: 'A quick tour of your training space — from your first plan to progress, backups, and AI. Follow along at your own pace.',
      tip: 'This is a read-only tour. It won’t log workouts, change your plan, or enable AI.', next: 'Let’s explore' },
    { id: 'navigation', route: '/home', target: '#tabbar', icon: 'house', eyebrow: 'Your training space', title: 'Five tabs. One routine.',
      body: 'Home is your daily overview. Plan holds your routines. Start opens a workout, Stats tracks progress, and Exercises is your movement library.',
      tip: 'Settings lives behind the gear on Home. You can replay this tour there anytime.' },
    { id: 'week', route: '/home', target: '[data-tour="week"]', icon: 'calendar', eyebrow: 'Home · Your week', title: 'See the bigger picture.',
      body: 'Your week shows planned sessions, completed workouts, and your streak. Select a day to change its plan, or open the calendar to look back.',
      tip: 'The arrows let you browse other weeks. Today brings you back to this one.' },
    { id: 'session', route: '/home', target: '[data-tour="session"]', icon: 'play', eyebrow: 'Home · Today’s session', title: 'Know what’s next.',
      body: 'Today’s routine and exercises appear here. Start it when you’re ready, view the routine, or build a plan if you’re just getting started.',
      tip: 'If a workout is already running, Home shows Resume instead. The tour never starts a session for you.' },
    { id: 'bodyweight', route: '/home', target: '[data-tour="bodyweight"]', icon: 'scale', eyebrow: 'Home · Body weight', title: 'Track your own trend.',
      body: 'Log a weigh-in and optionally set a goal. The chart follows your measurements over time — it isn’t a weight-loss prescription.',
      tip: 'You can edit past measurements and see longer trends in Stats.' },
    { id: 'plan', route: '/plan', target: '[data-tour="schedule"]', icon: 'clipboard', eyebrow: 'Plan · Weekly schedule', title: 'Build a week that fits.',
      body: 'Assign a routine to each training day and leave rest days open. Create your own routines or load the Push / Pull / Legs starter plan.',
      tip: 'Changing one date on Home is separate from changing your recurring weekly schedule.' },
    { id: 'routine', routineId, route: routineId ? '/plan/r/' + encodeURIComponent(routineId) : '/plan',
      target: routineId ? '[data-tour="routine"]' : '[data-tour="routines"]', icon: 'list', eyebrow: 'Plan · Routine builder', title: 'Make every set yours.',
      body: 'Open a routine to add or reorder exercises, choose sets and reps, and link supersets. You can also set a progression rule for how working weights develop.',
      tip: 'You don’t need a routine yet to finish the tour. Use New in Plan when you’re ready to create one.' },
    { id: 'workout', route: '/workout', target: '[data-tour="workout-start"]', icon: 'dumbbell', eyebrow: 'Workout · Getting started', title: 'Train your way.',
      body: 'Choose today’s plan, another routine, or a freestyle workout. During a session, enter weight and reps, then mark each completed set.',
      tip: 'Timed exercises and cardio use duration fields. Rest timers run between sets; the work timer times a hold.', sample: true },
    { id: 'finish', route: '/workout', target: '[data-tour="workout-start"]', icon: 'checkCircle', eyebrow: 'Workout · Save your session', title: 'Your work deserves a record.',
      body: 'Finish saves a workout to your history and shows its summary. You can add exercises as you go and resume an unfinished session on this device.',
      tip: 'An active workout stays on this device until you finish. Check any save or sync warning before closing the app.' },
    { id: 'library', route: '/library', target: '[data-tour="exercise-search"]', icon: 'magnifier', eyebrow: 'Exercises · Your library', title: 'Find your next movement.',
      body: 'Search by name, muscle, or equipment. Filters narrow the library, and an exercise opens instructions and an animation. Use Plan to add it to a routine.',
      tip: 'Missing a movement? Create your own exercise with a name and body part.' },
    { id: 'stats', route: '/stats', target: '[data-tour="stats"]', icon: 'chart', eyebrow: 'Stats · Your progress', title: 'Let the training tell its story.',
      body: 'See workout totals, consistency, body-weight trends, and exercise progress. As you log more sessions, the charts and muscle map become more useful.',
      tip: 'Estimated strength numbers are estimates. Logged effort is optional, and empty charts are normal before your first workout.' },
    { id: 'history', route: '/history', target: '[data-tour="history"]', icon: 'history', eyebrow: 'Stats · Workout history', title: 'Look back, set by set.',
      body: 'Open History from Stats to browse completed sessions. Select a workout to inspect its exercises, sets, duration, and personal records.',
      tip: 'Your completed history is separate from the workout currently in progress.' },
    { id: 'settings', route: '/settings', target: '[data-tour="preferences"]', icon: 'gear', eyebrow: 'Settings · Your preferences', title: 'Find your comfortable setup.',
      body: 'Choose your language and weight label, then adjust rest time, sounds, optional effort tracking, and appearance further down the page.',
      tip: 'Changing kg / lb changes the label only — it does not convert numbers you have already logged.' },
    { id: 'data', route: '/settings', target: '[data-tour="backups"]', icon: 'shield', eyebrow: 'Settings · Data & backups', title: 'Keep your training safe.',
      body: offline ? 'This build stores training on this device. Export a JSON backup to keep your own copy, or import data from another tracker.'
        : user ? 'Your completed training and plan sync to your signed-in profile. Sync status and recovery controls are in Settings. Export a JSON backup for your own copy.'
          : 'In guest mode, training stays in this browser. Create or sign in to a passkey profile in Account to use cloud sync. You can also export your own JSON backup.',
      tip: 'Importing a backup replaces current data. Review the confirmation and export a copy first. Reset is not part of this tour.' },
    { id: 'ai', route: offline ? '/settings' : '/settings/ai', target: offline ? undefined : '[data-tour="ai-setup"]',
      icon: 'key', eyebrow: 'AI · OpenRouter setup', title: 'AI is an option, not a requirement.',
      body: mobile ? 'This offline mobile build has no cloud AI setup. Use the hosted app for OpenRouter configuration and the AI Coach. You can still plan and log workouts here without AI.'
        : demo ? 'In this demo, Coach responses are simulated and no provider key is required. The hosted app offers real OpenRouter configuration in Settings.'
        : user?.admin ? 'As the owner, open Configure OpenRouter in Settings to add a provider key, select a free model, test it, and enable the Coach. The key is encrypted on the server.'
          : 'Configure OpenRouter is in Settings. Only the app owner can manage the shared key and model. A ChatGPT or Gemini subscription login is not an OpenRouter API key.',
      tip: 'AI remains off for your profile until you give consent. Free models can have usage limits and may be unavailable.' },
  ]
  if (coach) steps.push({ id: 'coach', route: '/coach', target: '[data-tour="coach"]', icon: 'sparkles', eyebrow: 'Coach · Your choice', title: 'A second opinion on your plan.',
    body: demo ? 'The demo Coach simulates plan design and reviews. In the cloud app, after you opt in, the Coach can use your training and intake answers to suggest a plan or adjustments.'
      : 'After you opt in, the Coach can use your training and intake answers to suggest a plan or review your sessions. Read each proposal and decide whether to apply it.',
    tip: 'Nothing is applied without your approval. You can undo the last accepted changes or turn the Coach off. This tour gives no consent.' })
  if (user?.admin && !offline) steps.push({ id: 'admin', route: '/admin', target: '[data-tour="admin"]', icon: 'wrench', eyebrow: 'Owner · Administration', title: 'Your app, under your control.',
    body: 'The Admin dashboard is available from Account settings. It lets the owner manage profiles, invitation codes, and instance-level AI controls.',
    tip: 'These controls are owner-only. The tour does not create invites or change anybody’s account.' })
  steps.push({ id: 'done', route: '/home', icon: 'checkCircle', eyebrow: 'You’re ready', title: 'Build. Train. Keep going.',
    body: 'Start with a plan, log your sessions, and watch your progress grow. Everything else can wait until you need it.',
    tip: 'Need a refresher? Settings → Help → App walkthrough.', next: 'Back to Home' })
  return steps
}

export function resolveWalkthroughStep(step, routines) {
  // A cloud refresh can remove a routine while the tour is open. Fall back to Plan
  // rather than fighting RoutineEdit's missing-routine redirect in a navigation loop.
  if (step.id === 'routine' && step.routineId && !routines.some(r => r.id === step.routineId)) {
    return { ...step, route: '/plan', target: '[data-tour="routines"]' }
  }
  return step
}

// A small, pure placement helper keeps the card on-screen at phone sizes and zoom levels.
export function walkthroughPlacement(target, viewport, card) {
  const gap = 18, edge = 16
  const width = Math.min(card.width, Math.max(0, viewport.width - edge * 2))
  const height = Math.min(card.height, Math.max(0, viewport.height - edge * 2))
  const clamp = (value, max) => Math.max(edge, Math.min(value, Math.max(edge, max - edge)))
  let left = (viewport.width - width) / 2, top = (viewport.height - height) / 2
  if (target) {
    if (target.right + gap + width <= viewport.width - edge) {
      left = target.right + gap; top = target.top + (target.height - height) / 2
    } else if (target.left - gap - width >= edge) {
      left = target.left - gap - width; top = target.top + (target.height - height) / 2
    } else if (target.bottom + gap + height <= viewport.height - edge) top = target.bottom + gap
    else if (target.top - gap - height >= edge) top = target.top - gap - height
    else top = viewport.height - height - edge
  }
  return { left: clamp(left, viewport.width - width), top: clamp(top, viewport.height - height) }
}
