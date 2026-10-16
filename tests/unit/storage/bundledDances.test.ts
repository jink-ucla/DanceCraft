import { describe, it, expect, vi } from 'vitest'
import {
  loadBundledDances,
  normalizeBundledDuration,
  parseBundledManifest,
  BUNDLED_MANIFEST_URL,
} from '../../../src/storage/bundledDances'

function textResponse(body: string, init: { status?: number; contentType?: string } = {}): Response {
  return new Response(body, {
    status: init.status ?? 200,
    headers: { 'content-type': init.contentType ?? 'application/json' },
  })
}

function mockFetch(response: Response | (() => Promise<Response>)) {
  return vi.fn(typeof response === 'function' ? response : async () => response) as unknown as typeof fetch & ReturnType<typeof vi.fn>
}

describe('loadBundledDances', () => {
  it('loads a valid manifest and maps entries to DanceInfo', async () => {
    const fetchImpl = mockFetch(textResponse(JSON.stringify({
      dances: [
        {
          id: 'wasil',
          title: 'Beat Wasil',
          poseDataUrl: '/dances/wasil.json',
          videoUrl: '/dances/wasil.mp4',
          duration: 17.35,
          thumbnail: '/dances/wasil.jpg',
          hostName: 'Wasil',
        },
        { id: 'warmup', title: 'Warm Up', poseDataUrl: '/dances/warmup.json', duration: '1:05' },
      ],
    })))

    const dances = await loadBundledDances(fetchImpl)

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe(BUNDLED_MANIFEST_URL)
    expect(url).toBe('/dances/manifest.json')
    expect(init).toMatchObject({ cache: 'no-store' })

    expect(dances).toEqual([
      {
        id: 'wasil',
        title: 'Beat Wasil',
        poseDataUrl: '/dances/wasil.json',
        videoUrl: '/dances/wasil.mp4',
        duration: '0:17',
        thumbnail: '/dances/wasil.jpg',
        hostName: 'Wasil',
        source: 'bundled',
      },
      {
        id: 'warmup',
        title: 'Warm Up',
        poseDataUrl: '/dances/warmup.json',
        duration: '1:05',
        source: 'bundled',
      },
    ])
  })

  it('skips invalid entries and keeps the valid ones', async () => {
    const fetchImpl = mockFetch(textResponse(JSON.stringify({
      dances: [
        null,
        'nope',
        [],
        { title: 'No id', poseDataUrl: '/dances/a.json', duration: 10 },
        { id: 'no-title', poseDataUrl: '/dances/b.json', duration: 10 },
        { id: 'no-poses', title: 'No poses', duration: 10 },
        { id: 'blank', title: '   ', poseDataUrl: '/dances/c.json', duration: 10 },
        { id: 'bad-duration', title: 'Bad', poseDataUrl: '/dances/d.json', duration: 'soon' },
        { id: 'neg-duration', title: 'Neg', poseDataUrl: '/dances/e.json', duration: -3 },
        { id: 'no-duration', title: 'None', poseDataUrl: '/dances/f.json' },
        { id: 'ok', title: 'OK', poseDataUrl: '/dances/ok.json', duration: 20, videoUrl: 42, hostName: '' },
        { id: 'ok', title: 'Duplicate id', poseDataUrl: '/dances/ok2.json', duration: 30 },
      ],
    })))

    const dances = await loadBundledDances(fetchImpl)
    expect(dances).toEqual([
      { id: 'ok', title: 'OK', poseDataUrl: '/dances/ok.json', duration: '0:20', source: 'bundled' },
    ])
  })

  it('returns [] on 404', async () => {
    const fetchImpl = mockFetch(textResponse('Not found', { status: 404, contentType: 'text/plain' }))
    expect(await loadBundledDances(fetchImpl)).toEqual([])
  })

  it("returns [] for Vite's index.html fallback", async () => {
    const html = '<!doctype html><html><body><div id="root"></div></body></html>'
    expect(await loadBundledDances(mockFetch(textResponse(html, { contentType: 'text/html' })))).toEqual([])
    // Even if the server lies about the content type.
    expect(await loadBundledDances(mockFetch(textResponse(html, { contentType: 'application/json' })))).toEqual([])
  })

  it('returns [] for non-JSON or wrongly shaped bodies', async () => {
    expect(await loadBundledDances(mockFetch(textResponse('{oops')))).toEqual([])
    expect(await loadBundledDances(mockFetch(textResponse('')))).toEqual([])
    expect(await loadBundledDances(mockFetch(textResponse('null')))).toEqual([])
    expect(await loadBundledDances(mockFetch(textResponse('[]')))).toEqual([])
    expect(await loadBundledDances(mockFetch(textResponse('{"dances":{}}')))).toEqual([])
    expect(await loadBundledDances(mockFetch(textResponse('{"dances":[]}')))).toEqual([])
  })

  it('returns [] when fetch rejects (network error / abort)', async () => {
    const fetchImpl = mockFetch(async () => { throw new TypeError('Failed to fetch') })
    expect(await loadBundledDances(fetchImpl)).toEqual([])
  })

  it('passes an AbortSignal through', async () => {
    const fetchImpl = mockFetch(textResponse('{"dances":[]}'))
    const controller = new AbortController()
    await loadBundledDances(fetchImpl, { signal: controller.signal })
    const [, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(init.signal).toBe(controller.signal)
  })

  it('uses the global fetch by default, called unbound-safe', async () => {
    const original = globalThis.fetch
    const spy = vi.fn(async function (this: unknown) {
      // Browsers throw if window.fetch is invoked with a foreign `this`.
      if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation')
      return textResponse('{"dances":[{"id":"a","title":"A","poseDataUrl":"/dances/a.json","duration":5}]}')
    })
    globalThis.fetch = spy as unknown as typeof fetch
    try {
      const dances = await loadBundledDances()
      expect(spy).toHaveBeenCalledTimes(1)
      expect(dances.map((d) => d.id)).toEqual(['a'])
    } finally {
      globalThis.fetch = original
    }
  })
})

describe('normalizeBundledDuration', () => {
  it('formats seconds as m:ss', () => {
    expect(normalizeBundledDuration(0)).toBe('0:00')
    expect(normalizeBundledDuration(9.99)).toBe('0:09')
    expect(normalizeBundledDuration(17.35)).toBe('0:17')
    expect(normalizeBundledDuration(65)).toBe('1:05')
    expect(normalizeBundledDuration(600)).toBe('10:00')
  })

  it('accepts m:ss and numeric strings', () => {
    expect(normalizeBundledDuration('1:05')).toBe('1:05')
    expect(normalizeBundledDuration(' 0:42 ')).toBe('0:42')
    expect(normalizeBundledDuration('12:00')).toBe('12:00')
    expect(normalizeBundledDuration('75')).toBe('1:15')
    expect(normalizeBundledDuration('20.5')).toBe('0:20')
  })

  it('rejects unusable values', () => {
    expect(normalizeBundledDuration(-1)).toBeNull()
    expect(normalizeBundledDuration(Number.NaN)).toBeNull()
    expect(normalizeBundledDuration(Number.POSITIVE_INFINITY)).toBeNull()
    expect(normalizeBundledDuration('1:5')).toBeNull()
    expect(normalizeBundledDuration('1:75')).toBeNull()
    expect(normalizeBundledDuration('abc')).toBeNull()
    expect(normalizeBundledDuration('')).toBeNull()
    expect(normalizeBundledDuration(null)).toBeNull()
    expect(normalizeBundledDuration(undefined)).toBeNull()
  })
})

describe('parseBundledManifest', () => {
  it('trims strings', () => {
    expect(parseBundledManifest({
      dances: [{ id: ' w ', title: ' Beat Wasil ', poseDataUrl: ' /dances/w.json ', duration: 3, hostName: ' Wasil ' }],
    })).toEqual([
      { id: 'w', title: 'Beat Wasil', poseDataUrl: '/dances/w.json', duration: '0:03', hostName: 'Wasil', source: 'bundled' },
    ])
  })
})
