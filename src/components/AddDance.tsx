import { useState, useEffect, useRef, useCallback } from 'react'
import './AddDance.css'
import { applyPendingMirror, setPendingMirror } from '../storage/danceSettings'

type ModalState =
  | { step: 'input' }
  | { step: 'processing'; jobId: string; status: string; progress: string }
  | { step: 'success'; title: string }
  | { step: 'error'; message: string }

const YOUTUBE_URL_REGEX = /^https?:\/\/(www\.)?(youtube\.com\/watch\?v=|youtube\.com\/shorts\/|youtu\.be\/|m\.youtube\.com\/watch\?v=)/

interface AddDanceProps {
  onClose: () => void
  onDanceAdded: () => void
  onJobStarted?: (jobId: string, youtubeUrl: string) => void
  apiBase?: string
}

export function AddDance({ onClose, onDanceAdded, onJobStarted, apiBase = 'http://localhost:3001' }: AddDanceProps) {
  const [url, setUrl] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [mirror, setMirror] = useState(false)
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
  const canSubmit = Boolean(file) || isValidUrl

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
    if (!canSubmit) return

    try {
      // Optional clip range: only that part is cut and analysed (much faster).
      let res: Response
      if (file) {
        const form = new FormData()
        form.append('video', file)
        if (startTime.trim()) form.append('startTime', startTime.trim())
        if (endTime.trim()) form.append('endTime', endTime.trim())
        setState({ step: 'processing', jobId: '', status: 'uploading', progress: 'Uploading video...' })
        res = await fetch(`${apiBase}/api/dances/upload`, { method: 'POST', body: form })
      } else {
        res = await fetch(`${apiBase}/api/dances/process`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            youtubeUrl: url.trim(),
            ...(startTime.trim() ? { startTime: startTime.trim() } : {}),
            ...(endTime.trim() ? { endTime: endTime.trim() } : {}),
          }),
        })
      }

      if (!res.ok) {
        const data = await res.json()
        setState({ step: 'error', message: data.error || 'Failed to start processing' })
        return
      }

      const data = await res.json()
      const jobId = data.jobId as string
      setState({ step: 'processing', jobId, status: data.status, progress: 'Starting...' })
      // Remember the mirror choice; it is applied to the dance once the job finishes
      // (here or in App's background poller if this dialog is closed).
      if (mirror) setPendingMirror(jobId, true)
      onJobStarted?.(jobId, file ? '' : url.trim())

      // Poll for job status
      pollRef.current = setInterval(async () => {
        try {
          const jobRes = await fetch(`${apiBase}/api/dances/jobs/${jobId}`)
          if (!jobRes.ok) return

          const job = await jobRes.json()

          if (job.status === 'complete') {
            stopPolling()
            applyPendingMirror(jobId, job.danceId)
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
              progress: job.progress || statusLabel(job.status),
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
            <p className="add-dance-desc">Paste a YouTube URL or Shorts link, or upload a video file.</p>
            <input
              className="add-dance-input"
              type="url"
              placeholder="https://youtube.com/watch?v=... or /shorts/..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && canSubmit) handleSubmit() }}
              disabled={Boolean(file)}
              autoFocus
            />
            {url.length > 0 && !isValidUrl && !file && (
              <p className="add-dance-validation">Please enter a valid YouTube URL</p>
            )}
            <div className="add-dance-or">or</div>
            <label className="add-dance-file">
              <input
                type="file"
                accept="video/*,.mp4,.mov,.m4v,.webm,.mkv"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              <span>{file ? `📹 ${file.name}` : 'Upload a video file (mp4, mov, webm)'}</span>
            </label>
            {file && (
              <button className="add-dance-file-clear" onClick={() => setFile(null)}>Use a YouTube link instead</button>
            )}
            <div className="add-dance-clip">
              <span className="add-dance-clip-label">Clip (optional)</span>
              <input
                className="add-dance-clip-input"
                placeholder="start 0:50"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              />
              <span className="add-dance-clip-dash">–</span>
              <input
                className="add-dance-clip-input"
                placeholder="end 1:25"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
              />
            </div>
            <p className="add-dance-clip-hint">Only this part is processed — a 30 s clip is ready in about a minute. Leave empty for the whole video.</p>
            <label className="add-dance-mirror">
              <input type="checkbox" checked={mirror} onChange={(e) => setMirror(e.target.checked)} />
              <span>
                <strong>Flip video (mirror)</strong> — turn on when the dancer faces the camera, so players can copy it like a mirror.
                You can change it later on the dance card.
              </span>
            </label>
            <button
              className="add-dance-submit"
              disabled={!canSubmit}
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
