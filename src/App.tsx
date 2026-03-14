import { useState, useRef, useCallback } from 'react'
import { HomeScreen } from './components/HomeScreen'
import type { DanceInfo } from './components/HomeScreen'
import { DanceMode } from './components/DanceMode'
import { ResultsScreen } from './components/ResultsScreen'
import { Settings } from './components/Settings'
import { History } from './components/History'
import { computePostDanceScore } from './scoring/dtw'
import { computeRank } from './scoring/dtw'
import { saveScore } from './storage/scores'
import type { DTWResult, TimestampedPose } from './scoring/dtw'
import type { Pose } from './scoring/types'
import './App.css'

const AVAILABLE_DANCES: DanceInfo[] = [
  {
    id: 'sample-dance',
    title: 'Sample Dance',
    poseDataUrl: '/dances/sample-dance.json',
    duration: '0:30',
  },
]

type View =
  | { screen: 'home' }
  | { screen: 'dance'; dance: DanceInfo }
  | { screen: 'results'; dance: DanceInfo; result: DTWResult }
  | { screen: 'settings' }
  | { screen: 'history' }

function App() {
  const [view, setView] = useState<View>({ screen: 'home' })
  const userPosesRef = useRef<TimestampedPose[]>([])
  const referencePosesRef = useRef<TimestampedPose[]>([])

  const handleDanceFinish = useCallback((_score: number, _hits: number, _total: number) => {
    if (view.screen !== 'dance') return

    const result = computePostDanceScore(
      referencePosesRef.current,
      userPosesRef.current,
    )

    const scorePct = result.overallScore * 100

    // Save to score history
    saveScore({
      danceId: view.dance.id,
      danceName: view.dance.title,
      score: scorePct,
      rank: computeRank(result.overallScore),
      date: new Date().toISOString(),
    })

    setView({ screen: 'results', dance: view.dance, result })
  }, [view])

  const handleRecordPose = useCallback((pose: Pose, time: number) => {
    userPosesRef.current.push({ time, pose })
  }, [])

  if (view.screen === 'history') {
    return (
      <div className="app">
        <History onBack={() => setView({ screen: 'home' })} />
      </div>
    )
  }

  if (view.screen === 'settings') {
    return (
      <div className="app">
        <Settings onBack={() => setView({ screen: 'home' })} />
      </div>
    )
  }

  if (view.screen === 'results') {
    return (
      <div className="app">
        <ResultsScreen
          result={view.result}
          danceName={view.dance.title}
          onRetry={() => {
            userPosesRef.current = []
            setView({ screen: 'dance', dance: view.dance })
          }}
          onHome={() => setView({ screen: 'home' })}
        />
      </div>
    )
  }

  if (view.screen === 'dance') {
    return (
      <div className="app">
        <DanceMode
          referencePoseUrl={view.dance.poseDataUrl}
          onFinish={handleDanceFinish}
          onRecordPose={handleRecordPose}
          onReferencePosesLoaded={(poses) => {
            referencePosesRef.current = poses
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
        onSelectDance={(dance) => {
          userPosesRef.current = []
          setView({ screen: 'dance', dance })
        }}
        onSettings={() => setView({ screen: 'settings' })}
        onHistory={() => setView({ screen: 'history' })}
      />
    </div>
  )
}

export default App
