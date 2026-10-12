// Development-only visual harness, outside the production entry graph. Interactive app
// flows are checked on the real demo app separately; this page does not persist any data.
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import TrainingDashboard from '../src/components/TrainingDashboard.jsx'
import { WorkoutTabBar } from '../src/components/TabBar.jsx'
import { registerCustom } from '../src/lib/exercises.js'
import { reviewDate, reviewExercises, reviewState } from './design-fixture.js'
import '../src/index.css'

registerCustom(reviewExercises)
const noop = () => {}
function Review() {
  const [weekOffset, setWeekOffset] = useState(0)
  return <><main id="app"><TrainingDashboard S={reviewState()} today={reviewDate}
    weekOffset={weekOffset} onWeekChange={setWeekOffset} onSettings={noop} onDay={noop} onCalendar={noop}
    onSession={noop} onRoutine={noop} onExercise={noop} onLogWeight={noop} onGoal={noop}
    onStarter={noop} onBuildPlan={noop} onCoach={noop} /></main>
    <WorkoutTabBar current="home" onNavigate={noop} onStart={noop} />
  </>
}
createRoot(document.getElementById('review-root')).render(<Review />)
