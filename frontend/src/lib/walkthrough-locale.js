import { walkthroughSteps } from './walkthrough.js'

// Each lazy-loaded locale supplies [eyebrow, title, body, tip, optional next]
// for every step. Keep the English keys in one place (the tour itself), with
// strict shape checks so adding copy cannot silently leave another language out.
const fields = ['eyebrow', 'title', 'body', 'tip', 'next']
const sourceSteps = walkthroughSteps({ user: { admin: true }, coach: true })
const body = (options, id) => walkthroughSteps(options).find(step => step.id === id).body
const variants = {
  dataOffline: body({ mobile: true }, 'data'),
  dataGuest: body({}, 'data'),
  aiMobile: body({ mobile: true }, 'ai'),
  aiDemo: body({ demo: true }, 'ai'),
  aiMember: body({}, 'ai'),
  coachDemo: body({ demo: true, coach: true }, 'coach'),
}
const controls = {
  skip: 'Skip tour', progress: 'Walkthrough progress', sample: 'Read-only example of a logged set',
  example: 'Example only', set: 'Set {0}', weightReps: 'Weight × reps',
  sampleHint: 'Enter your numbers, then mark the set done.', duration: 'About 3 minutes',
  help: 'Help', entry: 'App walkthrough', summary: 'A guided tour of planning, workouts, progress, backups, and AI',
  busyWorkout: 'Finish your workout before starting the walkthrough.',
  busyDialog: 'Close the open dialog before starting the walkthrough.',
}

export const walkthroughLocaleKeys = [
  ...sourceSteps.flatMap(step => fields.filter(field => step[field]).map(field => step[field])),
  ...Object.values(variants), ...Object.values(controls),
]

export function makeWalkthroughLocale(copy) {
  const dict = {}
  const add = (key, value) => {
    if (typeof value !== 'string' || !value.trim()) throw new Error('Missing walkthrough translation: ' + key)
    dict[key] = value
  }
  for (const step of sourceSteps) {
    const activeFields = fields.filter(field => step[field])
    const row = copy[step.id]
    if (!Array.isArray(row) || row.length !== activeFields.length) throw new Error('Invalid walkthrough translation: ' + step.id)
    activeFields.forEach((field, i) => add(step[field], row[i]))
  }
  for (const [id, key] of Object.entries(variants)) add(key, copy.variants?.[id])
  for (const [id, key] of Object.entries(controls)) add(key, copy.controls?.[id])
  return dict
}
