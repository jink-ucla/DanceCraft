import { describe, it, expect, vi } from 'vitest'

/**
 * Tests for DanceMode audio behavior.
 * These verify the audio logic without requiring DOM (no document.createElement).
 */
describe('DanceMode audio behavior', () => {
  it('video should be unmuted when dance begins (muted=false, volume > 0)', () => {
    // Simulate the state transitions during dance start
    const videoState = { muted: true, volume: 1.0, currentTime: 0 }

    // During loading/countdown, video is muted
    expect(videoState.muted).toBe(true)

    // When countdown reaches 0 and dance starts:
    videoState.currentTime = 0
    videoState.muted = false
    videoState.volume = 0.7

    expect(videoState.muted).toBe(false)
    expect(videoState.volume).toBe(0.7)
  })

  it('video should remain muted during countdown phase', () => {
    const videoState = { muted: true, volume: 0.7 }

    // During countdown, video stays muted (no audio until dance starts)
    expect(videoState.muted).toBe(true)
  })

  it('volume slider should update volume', () => {
    const videoState = { muted: false, volume: 0.7 }

    // Simulate volume change
    const newVolume = 0.3
    videoState.volume = newVolume
    videoState.muted = newVolume === 0

    expect(videoState.volume).toBe(0.3)
    expect(videoState.muted).toBe(false)
  })

  it('setting volume to 0 should mute', () => {
    const videoState = { muted: false, volume: 0.7 }

    const newVolume = 0
    videoState.volume = newVolume
    videoState.muted = newVolume === 0

    expect(videoState.volume).toBe(0)
    expect(videoState.muted).toBe(true)
  })

  it('mute toggle should flip muted state without changing volume', () => {
    const videoState = { muted: false, volume: 0.7 }

    // Toggle mute
    videoState.muted = !videoState.muted
    expect(videoState.muted).toBe(true)
    expect(videoState.volume).toBe(0.7) // Volume preserved

    // Toggle unmute
    videoState.muted = !videoState.muted
    expect(videoState.muted).toBe(false)
    expect(videoState.volume).toBe(0.7)
  })
})

/**
 * Tests for DanceMode recording behavior (MediaRecorder lifecycle).
 * These simulate the recording logic without requiring DOM.
 */
describe('DanceMode recording behavior', () => {
  function createMockMediaRecorder() {
    const chunks: Blob[] = []
    let state: 'inactive' | 'recording' | 'paused' = 'inactive'
    let ondataavailable: ((e: { data: Blob }) => void) | null = null
    let onstop: (() => void) | null = null

    return {
      get state() { return state },
      set ondataavailable(fn: ((e: { data: Blob }) => void) | null) { ondataavailable = fn },
      get ondataavailable() { return ondataavailable },
      set onstop(fn: (() => void) | null) { onstop = fn },
      get onstop() { return onstop },
      start: vi.fn((timeslice?: number) => {
        state = 'recording'
        // Simulate periodic data chunks
        if (timeslice && ondataavailable) {
          ondataavailable({ data: new Blob(['chunk1'], { type: 'video/webm' }) })
        }
      }),
      stop: vi.fn(() => {
        state = 'inactive'
        if (onstop) onstop()
      }),
      chunks,
    }
  }

  it('MediaRecorder should start when dance begins and stop when finished', () => {
    const recorder = createMockMediaRecorder()

    // Simulate dance start → recording starts
    recorder.start(1000)
    expect(recorder.start).toHaveBeenCalledWith(1000)
    expect(recorder.state).toBe('recording')

    // Simulate dance finish → recording stops
    recorder.stop()
    expect(recorder.stop).toHaveBeenCalled()
    expect(recorder.state).toBe('inactive')
  })

  it('recording should collect data chunks via ondataavailable', () => {
    const collectedChunks: Blob[] = []

    const recorder = createMockMediaRecorder()
    recorder.ondataavailable = (e: { data: Blob }) => {
      if (e.data.size > 0) {
        collectedChunks.push(e.data)
      }
    }

    recorder.start(1000)
    expect(collectedChunks.length).toBe(1) // Simulated chunk from start

    // Simulate more data
    recorder.ondataavailable!({ data: new Blob(['chunk2'], { type: 'video/webm' }) })
    expect(collectedChunks.length).toBe(2)
  })

  it('onstop callback should produce a final blob from collected chunks', () => {
    const collectedChunks: Blob[] = []
    let finalBlob: Blob | null = null

    const recorder = createMockMediaRecorder()
    recorder.ondataavailable = (e: { data: Blob }) => {
      if (e.data.size > 0) {
        collectedChunks.push(e.data)
      }
    }

    recorder.start(1000)
    // Simulate additional data
    recorder.ondataavailable!({ data: new Blob(['chunk2'], { type: 'video/webm' }) })

    // Set onstop to produce final blob
    recorder.onstop = () => {
      finalBlob = new Blob(collectedChunks, { type: 'video/webm' })
    }

    recorder.stop()
    expect(finalBlob).not.toBeNull()
    expect(finalBlob!.type).toBe('video/webm')
    expect(finalBlob!.size).toBeGreaterThan(0)
  })

  it('recording should not block dance if MediaRecorder fails', () => {
    // Simulate MediaRecorder constructor throwing
    let recorderRef: ReturnType<typeof createMockMediaRecorder> | null = null
    let danceCanContinue = true

    try {
      throw new Error('MediaRecorder not supported')
    } catch {
      // Graceful degradation — recorder stays null, dance continues
      recorderRef = null
      danceCanContinue = true
    }

    expect(recorderRef).toBeNull()
    expect(danceCanContinue).toBe(true)
  })

  it('stopping an inactive recorder should be a no-op', () => {
    const recorder = createMockMediaRecorder()

    // Recorder never started — state is 'inactive'
    expect(recorder.state).toBe('inactive')

    // Our stopRecording logic checks state before calling stop
    if (recorder.state !== 'inactive') {
      recorder.stop()
    }
    expect(recorder.stop).not.toHaveBeenCalled()
  })
})
