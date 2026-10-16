import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import type { ComponentProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ResultsScreen } from '../../../src/components/ResultsScreen'

/**
 * Static render (no DOM, effects do not run, so the coach/battle never fetch):
 * checks the "Your clip" card and the "Why this score?" evidence markup.
 */
type Props = ComponentProps<typeof ResultsScreen>

const noop = () => {}

function render(overrides: Partial<Props> = {}): string {
  const props: Props = {
    result: {
      overallScore: 0.31,
      rank: 'C',
      sectionScores: [
        { startTime: 0, endTime: 10, score: 0.4 },
        { startTime: 10, endTime: 20, score: 0.22 },
      ],
      bodyPartScores: [
        { name: 'Arms', score: 0.42, tracked: true },
        { name: 'Legs', score: 0, tracked: false },
      ],
      alignment: [],
      coverage: 0.37,
      motionMatch: 0.1,
      latencyMs: 200,
      mirrored: true,
      notes: ['Your legs were out of frame — step back so your full body is visible.'],
    },
    danceName: 'I NEED U',
    onRetry: noop,
    onHome: noop,
    durationSeconds: 20,
    ...overrides,
  }
  return renderToStaticMarkup(createElement(ResultsScreen, props))
}

describe('ResultsScreen — why this score', () => {
  it('shows tracked share, motion match, latency, mirror and tips', () => {
    const html = render()
    expect(html).toContain('Why this score?')
    expect(html).toContain('Tracked 37% of the song')
    expect(html).toContain('Moving with the dance: 10%')
    expect(html).toContain('Latency compensated: 200 ms')
    expect(html).toContain('Mirror-style detected')
    expect(html).toContain('Your legs were out of frame — step back so your full body is visible.')
  })

  it('greys out untracked body parts instead of a red 0% bar', () => {
    const html = render()
    expect(html).toContain('breakdown-item--untracked')
    expect(html).toContain('out of frame')
    // Arms still gets a normal bar; Legs gets no 0% value
    expect(html).toContain('42%')
    expect(html).not.toMatch(/breakdown-value">0%/)
  })

  it('renders no evidence block for a legacy result', () => {
    const html = render({
      result: {
        overallScore: 0.6,
        rank: 'B',
        sectionScores: [{ startTime: 0, endTime: 10, score: 0.6 }],
        bodyPartScores: [{ name: 'Arms', score: 0.6 }, { name: 'Legs', score: 0 }],
        alignment: [],
      },
    })
    expect(html).not.toContain('Why this score?')
    expect(html).not.toContain('out of frame')
    expect(html).toContain('0%')
  })
})

describe('ResultsScreen — your clip', () => {
  it('plays the recording inline (muted, playsInline, controls, loop) with replay + all clips', () => {
    const html = render({ clipUrl: 'blob:http://localhost/clip-1', onReplay: noop, onOpenHistory: noop })
    expect(html).toContain('Your clip')
    const video = html.match(/<video[^>]*class="results-clip-video"[^>]*>/)?.[0] ?? ''
    expect(video).toContain('src="blob:http://localhost/clip-1"')
    expect(video).toMatch(/\bmuted=""/)
    expect(video).toMatch(/\bplaysInline=""|\bplaysinline=""/i)
    expect(video).toMatch(/\bcontrols=""/)
    expect(video).toMatch(/\bloop=""/)
    expect(html).toContain('Watch side-by-side replay')
    expect(html).toContain('All clips')
  })

  it('labels a stand-in clip', () => {
    const html = render({ clipUrl: 'http://localhost:3003/api/dances/1/video', clipLabel: 'Preview clip', onReplay: noop })
    expect(html).toContain('results-clip-badge')
    expect(html).toContain('Preview clip')
  })

  it('explains a missing clip and offers no replay', () => {
    const html = render({ clipUrl: null })
    expect(html).toContain('No clip was recorded this time')
    expect(html).not.toContain('Watch side-by-side replay')
    expect(html).not.toContain('<video')
  })
})
