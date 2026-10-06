// Synthetic screenshot data only. Never loaded by the production entry point or saved.
export const reviewDate = new Date('2026-10-04T12:00:00')
export const reviewExercises = [
  { id: 'review-bench', n: 'Bench press', bp: 'chest' },
  { id: 'review-incline', n: 'Incline dumbbell press', bp: 'chest' }
]
export function reviewState() {
  const routine = { id: 'review-push', name: 'Push day', emoji: 'barbell', ex: [
    ...reviewExercises.map(e => ({ id: e.id, sets: 3, reps: '8–10', weight: 0 })),
    ...['0426', '0334', '0241', '0251'].map(id => ({ id, sets: 3, reps: 10, weight: 0 }))
  ] }
  return {
    unit: 'kg', routines: [routine], week: { 1: routine.id, 3: routine.id, 6: routine.id, 0: routine.id }, dayPlan: {},
    active: null, targetW: null, coach: null, customEx: reviewExercises,
    workouts: ['2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28', '2026-09-30', '2026-10-03']
      .map((d, i) => ({ id: 'review-' + i, d, entries: [] })),
    bodyweight: [76.5, 75.5, 75.6, 74, 74.5, 74, 74.5, 75.2].map((w, i) => {
      const date = new Date('2026-09-28T12:00:00'); date.setHours(12 + i * 144 / 7)
      const d = date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0')
      return { d, t: +date, w }
    })
  }
}
