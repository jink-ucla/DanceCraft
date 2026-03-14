import { useState } from 'react'
import { DanceMode } from './components/DanceMode'
import './App.css'

type View = 'home' | 'dance'

function App() {
  const [view, setView] = useState<View>('home')

  if (view === 'dance') {
    return (
      <div className="app">
        <DanceMode
          referencePoseUrl="/dances/sample-dance.json"
          onFinish={(score, hits, total) => {
            console.log(`Dance finished: ${score} points, ${hits}/${total} hits`)
            setView('home')
          }}
        />
        <button
          style={{ marginTop: 16 }}
          onClick={() => setView('home')}
        >
          Back
        </button>
      </div>
    )
  }

  return (
    <div className="app">
      <h1>Groovy</h1>
      <p>Dance along to any video with real-time pose feedback!</p>
      <button onClick={() => setView('dance')}>
        Start Dancing
      </button>
    </div>
  )
}

export default App
