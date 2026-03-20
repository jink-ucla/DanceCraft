import { describe, it, expect } from 'vitest'
import { isValidYoutubeUrl } from '../../../server/processing.ts'

describe('isValidYoutubeUrl', () => {
  it('accepts standard youtube.com watch URLs', () => {
    expect(isValidYoutubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(true)
  })

  it('accepts youtube.com without www', () => {
    expect(isValidYoutubeUrl('https://youtube.com/watch?v=abc123')).toBe(true)
  })

  it('accepts youtu.be short URLs', () => {
    expect(isValidYoutubeUrl('https://youtu.be/dQw4w9WgXcQ')).toBe(true)
  })

  it('accepts mobile youtube URLs', () => {
    expect(isValidYoutubeUrl('https://m.youtube.com/watch?v=abc123')).toBe(true)
  })

  it('accepts YouTube Shorts URLs', () => {
    expect(isValidYoutubeUrl('https://www.youtube.com/shorts/sSM9J5YH_60')).toBe(true)
    expect(isValidYoutubeUrl('https://youtube.com/shorts/abc123def45')).toBe(true)
  })

  it('rejects non-YouTube URLs', () => {
    expect(isValidYoutubeUrl('https://vimeo.com/123')).toBe(false)
    expect(isValidYoutubeUrl('https://example.com')).toBe(false)
  })

  it('rejects non-URL strings', () => {
    expect(isValidYoutubeUrl('not-a-url')).toBe(false)
    expect(isValidYoutubeUrl('')).toBe(false)
  })
})
