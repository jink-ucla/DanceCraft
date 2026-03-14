import { useState } from 'react'
import { HomeScreen } from './components/HomeScreen'
import type { DanceInfo } from './components/HomeScreen'
import { DanceMode } from './components/DanceMode'
import './App.css'

const AVAILABLE_DANCES: DanceInfo[] = [
  {
    id: 'sample-dance',
    title: 'Sample Dance',
    poseDataUrl: '/dances/sample-dance.json',
    duration: '0:30',
  },
]

type View = { screen: 'home' } | { screen: 'dance'; dance: DanceInfo }

function App() {
  const [view, setView] = useState<View>({ screen: 'home' })

  if (view.screen === 'dance') {
    return (
      <div className="app">
        <DanceMode
          referencePoseUrl={view.dance.poseDataUrl}
          onFinish={(score) => {
            // Save personal best
            const key = `groovy_best_${view.dance.id}`
            const prev = localStorage.getItem(key)
            const prevScore = prev ? JSON.parse(prev) : 0
            if (score > prevScore) {
              localStorage.setItem(key, JSON.stringify(score))
            }
            setView({ screen: 'home' })
          }}
        />
        <button
          className="back-button"
          onClick={() => setView({ screen: 'home' })}
        >
          Back
        </button>
      </div>
    )
  }

  return (
    <div className="app">
      <HomeScreen
        dances={AVAILABLE_DANCES}
        onSelectDance={(dance) => setView({ screen: 'dance', dance })}
      />
    </div>
  )
}

export default App
