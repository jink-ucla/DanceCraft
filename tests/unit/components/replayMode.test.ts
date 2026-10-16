import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createElement } from 'react'
import type { ComponentProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ReplayMode } from '../../../src/components/ReplayMode'

/**
 * Static render (no DOM, effects do not run, so nothing is fetched): checks the
 * side-by-side default layout, the "YOU" label and the per-video Mirror toggle.
 */
type Props = ComponentProps<typeof ReplayMode>

const store: Record<string, string> = {}

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key]
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value },
    removeItem: (key: string) => { delete store[key] },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function render(overrides: Partial<Props> = {}): string {
  const props: Props = {
    referenceVideoUrl: 'http://localhost/ref.mp4',
    danceId: 'api-7',
    userVideoUrl: 'blob:http://localhost/rec-1',
    userPoses: [],
    sectionScores: [{ startTime: 0, endTime: 10, score: 0.5 }],
    sessionMeta: { date: '2026-10-15T12:00:00.000Z', score: 50, rank: 'C' },
    onBack: () => {},
    ...overrides,
  }
  return renderToStaticMarkup(createElement(ReplayMode, props))
}

function tagFor(html: string, viewClass: string, tag: 'video' | 'canvas'): string {
  const start = html.indexOf(viewClass)
  expect(start).toBeGreaterThanOrEqual(0)
  return html.slice(start).match(new RegExp(`<${tag}[^>]*>`))?.[0] ?? ''
}

describe('ReplayMode — your video', () => {
  it('defaults to side by side with a clearly labelled YOU pane', () => {
    const html = render()
    expect(html).toContain('replay-mode--split')
    expect(html).toMatch(/replay-pane replay-ref-view/)
    expect(html).toMatch(/replay-pane replay-user-view/)
    expect(html).toContain('REFERENCE')
    expect(html).toMatch(/replay-pip-label--you">YOU</)
    expect(html).toContain('Side by side')
    expect(html).toContain('Swap')
    // The recording plays selfie-style, as the user saw themselves while dancing
    expect(tagFor(html, 'replay-user-view', 'video')).toContain('src="blob:http://localhost/rec-1"')
    expect(tagFor(html, 'replay-user-view', 'video')).toContain('scaleX(-1)')
  })

  it('labels a stand-in clip and can show it unmirrored', () => {
    const html = render({ userVideoLabel: 'PREVIEW CLIP', mirrorUserVideo: false })
    expect(html).toMatch(/replay-pip-label--you">PREVIEW CLIP</)
    expect(tagFor(html, 'replay-user-view', 'video')).not.toContain('scaleX(-1)')
  })

  it('explains a missing recording', () => {
    const html = render({ userVideoUrl: '' })
    expect(html).toContain('No recording for this attempt.')
  })
})

describe('ReplayMode — per-video mirror', () => {
  it('shows Mirror OFF and an unflipped reference by default', () => {
    const html = render()
    expect(html).toMatch(/replay-mirror-btn[^"]*" title="[^"]*" aria-pressed="false">Mirror OFF</)
    expect(tagFor(html, 'replay-ref-view', 'video')).not.toContain('scaleX(-1)')
    expect(tagFor(html, 'replay-ref-view', 'canvas')).not.toContain('scaleX(-1)')
  })

  it('follows the saved mirror setting of this dance (video and skeleton overlay)', () => {
    store['groovy_dance_settings_api-7'] = JSON.stringify({ mirror: true, customKeyPoses: null, tutorialUrl: '' })
    const html = render()
    expect(html).toMatch(/aria-pressed="true">Mirror ON</)
    expect(tagFor(html, 'replay-ref-view', 'video')).toContain('scaleX(-1)')
    expect(tagFor(html, 'replay-ref-view', 'canvas')).toContain('scaleX(-1)')
  })

  it('ignores the mirror setting of another dance', () => {
    store['groovy_dance_settings_api-8'] = JSON.stringify({ mirror: true })
    expect(render()).toContain('Mirror OFF')
  })
})
