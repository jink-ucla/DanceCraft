import { useState, useEffect, useRef, useCallback } from 'react'

type ModalState =
  | { step: 'input' }
  | { step: 'processing'; jobId: string; status: string; progress: string }
  | { step: 'success'; title: string }
  | { step: 'error'; message: string }

const YOUTUBE_URL_REGEX = /^https?:\/\/(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/|m\.youtube\.com\/watch\?v=)/

interface AddDanceProps {
  onClose: () => void
  onDanceAdded: () => void
  onJobStarted?: (jobId: string, youtubeUrl: string) => void
  apiBase?: string
}

export function AddDance({ onClose, onDanceAdded, onJobStarted, apiBase = 'http://localhost:3001' }: AddDanceProps) {
  const [url, setUrl] = useState('')
  const [state, setState] = useState<ModalState>({ step: 'input' })
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  useEffect(() => {
    return () => stopPolling()
  }, [stopPolling])

  const isValidUrl = YOUTUBE_URL_REGEX.test(url.trim())

  const statusLabel = (status: string): string => {
    switch (status) {
      case 'queued': return 'Starting...'
      case 'downloading': return 'Downloading video...'
      case 'extracting_audio': return 'Extracting audio...'
      case 'extracting_poses': return 'Extracting poses...'
      case 'generating_thumbnail': return 'Almost done...'
      case 'complete': return 'Complete!'
      default: return status
    }
  }

  const handleSubmit = async () => {
    if (!isValidUrl) return

    try {
      const res = await fetch(`${apiBase}/api/dances/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ youtubeUrl: url.trim() }),
      })

      if (!res.ok) {
        const data = await res.json()
        setState({ step: 'error', message: data.error || 'Failed to start processing' })
        return
      }

      const data = await res.json()
      const jobId = data.jobId as string
      setState({ step: 'processing', jobId, status: data.status, progress: 'Starting...' })
      onJobStarted?.(jobId, url.trim())

      // Poll for job status
      pollRef.current = setInterval(async () => {
        try {
          const jobRes = await fetch(`${apiBase}/api/dances/jobs/${jobId}`)
          if (!jobRes.ok) return

          const job = await jobRes.json()

          if (job.status === 'complete') {
            stopPolling()
            setState({ step: 'success', title: job.metadata?.title || 'New Dance' })
            onDanceAdded()
          } else if (job.status === 'error') {
            stopPolling()
            setState({ step: 'error', message: job.error || 'Processing failed' })
          } else {
            setState({
              step: 'processing',
              jobId,
              status: job.status,
              progress: statusLabel(job.status),
            })
          }
        } catch {
          // Network error during polling — keep trying
        }
      }, 1500)
    } catch {
      setState({ step: 'error', message: 'Could not connect to server. Is the backend running?' })
    }
  }

  return (
    <div className="add-dance-backdrop" onClick={onClose}>
      <div className="add-dance-modal" onClick={(e) => e.stopPropagation()}>
        <button className="add-dance-close" onClick={onClose} aria-label="Close">
          &times;
        </button>

        <h2 className="add-dance-title">Add Dance</h2>

        {state.step === 'input' && (
          <>
            <p className="add-dance-desc">Paste a YouTube URL to add a dance to your library.</p>
            <input
              className="add-dance-input"
              type="url"
              placeholder="https://youtube.com/watch?v=..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && isValidUrl) handleSubmit() }}
              autoFocus
            />
            {url.length > 0 && !isValidUrl && (
              <p className="add-dance-validation">Please enter a valid YouTube URL</p>
            )}
            <button
              className="add-dance-submit"
              disabled={!isValidUrl}
              onClick={handleSubmit}
            >
              Add Dance
            </button>
          </>
        )}

        {state.step === 'processing' && (
          <div className="add-dance-processing">
            <div className="add-dance-spinner" />
            <p className="add-dance-progress">{state.progress}</p>
            <p className="add-dance-hint">You can close this and come back — processing continues in the background.</p>
          </div>
        )}

        {state.step === 'success' && (
          <div className="add-dance-result">
            <div className="add-dance-check">&#10003;</div>
            <p className="add-dance-success-text">
              <strong>{state.title}</strong> has been added to your library!
            </p>
            <button className="add-dance-submit" onClick={onClose}>
              Done
            </button>
          </div>
        )}

        {state.step === 'error' && (
          <div className="add-dance-result">
            <p className="add-dance-error-text">{state.message}</p>
            <button
              className="add-dance-submit"
              onClick={() => setState({ step: 'input' })}
            >
              Try Again
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
