import { expect, test } from '@playwright/test'

interface ClockHarness {
  poses: { time: number; videoTime: number; pose: { keypoints: { x: number }[] } }[]
  sampledReferenceTimes: number[]
  recording: Blob | null
  finished: boolean
  showReplay: (missingRecording?: boolean) => void
}
declare global { interface Window { __clockHarness: ClockHarness } }

for (const manualFrames of [true, false]) {
test(`capture music clock and replay drift (${manualFrames ? 'manual frames' : 'automatic frame fallback'})`, async ({ page }) => {
  test.setTimeout(45000)
  if (!manualFrames) {
    await page.addInitScript(() => {
      const captureStream = HTMLCanvasElement.prototype.captureStream
      HTMLCanvasElement.prototype.captureStream = function (frameRate) {
        const stream = captureStream.call(this, frameRate)
        for (const track of stream.getVideoTracks()) Object.defineProperty(track, 'requestFrame', { value: undefined })
        return stream
      }
    })
  }
  // Exercise real DanceMode + MediaRecorder, but make inference deliberately
  // slow and deterministic rather than requiring a model download or webcam.
  await page.route('**/src/pose/detector.ts*', (route) => route.fulfill({
    contentType: 'application/javascript',
    body: `
      export async function initDetector() {}
      export function disposeDetector() {}
      export async function estimatePose(input) {
        if (input instanceof HTMLVideoElement) return null;
        const ref = document.querySelector('.dance-reference-video');
        window.__clockHarness.sampledReferenceTimes.push(ref.currentTime);
        const pixels = input.getContext('2d').getImageData(0, 100, 320, 1).data;
        let x = 0;
        while (x < 320 && pixels[x * 4] < 180) x++;
        await new Promise(resolve => setTimeout(resolve, 120));
        return { keypoints: [{ name: 'nose', x, y: 10, score: 1 }] };
      }
    `,
  }))
  await page.goto('/tests/e2e/fixtures/recording-clock.html')
  await page.locator('.dance-ready-overlay').click({ timeout: 15000 })
  await expect.poll(() => page.evaluate(() => window.__clockHarness.poses.length)).toBeGreaterThan(4)
  // Simulate the exact class of fault: reference playback stalls while the
  // camera recorder continues, so wall-clock seconds are not music seconds.
  await page.evaluate(() => document.querySelector<HTMLVideoElement>('.dance-reference-video')!.pause())
  await page.waitForTimeout(450)
  await page.evaluate(() => document.querySelector<HTMLVideoElement>('.dance-reference-video')!.play())
  await expect.poll(() => page.evaluate(() => window.__clockHarness.finished), { timeout: 15000 }).toBe(true)
  const audit = await page.evaluate(() => {
    const h = window.__clockHarness
    return {
      count: h.poses.length,
      maxMusicTimestampError: Math.max(...h.poses.map((pose, index) => Math.abs(pose.time - h.sampledReferenceTimes[index]))),
      referenceSpan: h.poses.at(-1)!.time - h.poses[0].time,
      recordingSpan: h.poses.at(-1)!.videoTime - h.poses[0].videoTime,
      blobSize: h.recording?.size ?? 0,
    }
  })
  expect(audit.count).toBeGreaterThan(15)
  expect(audit.blobSize).toBeGreaterThan(1000)
  expect(audit.maxMusicTimestampError).toBeLessThan(0.02)
  expect(audit.recordingSpan - audit.referenceSpan).toBeGreaterThan(0.25)

  const frameErrors = await page.evaluate(async () => {
    const h = window.__clockHarness
    const video = document.createElement('video')
    video.muted = true
    video.src = URL.createObjectURL(h.recording!)
    await new Promise<void>((resolve) => video.onloadeddata = () => resolve())
    const canvas = document.createElement('canvas')
    canvas.width = 320; canvas.height = 240
    const ctx = canvas.getContext('2d')!
    const errors = []
    for (const index of [3, Math.floor(h.poses.length / 2), h.poses.length - 3]) {
      const sample = h.poses[index]
      const seeked = new Promise<void>((resolve) => video.onseeked = () => resolve())
      video.currentTime = sample.videoTime + 0.03
      await seeked
      ctx.drawImage(video, 0, 0, 320, 240)
      const pixels = ctx.getImageData(0, 100, 320, 1).data
      let x = 0
      while (x < 320 && pixels[x * 4] < 180) x++
      errors.push(Math.abs(x - sample.pose.keypoints[0].x))
    }
    URL.revokeObjectURL(video.src)
    return errors
  })
  expect(Math.max(...frameErrors)).toBeLessThanOrEqual(4)

  await page.evaluate(() => window.__clockHarness.showReplay())
  await expect.poll(() => page.evaluate(() => document.querySelector<HTMLVideoElement>('.replay-user-view video')?.readyState ?? 0)).toBeGreaterThanOrEqual(2)
  await page.getByRole('button', { name: 'Play', exact: true }).evaluate((button: HTMLButtonElement) => button.click())
  await expect.poll(() => page.evaluate(() => document.querySelector<HTMLVideoElement>('.replay-user-view video')!.currentTime)).toBeGreaterThan(1.5)
  // Desynchronize just the reference decoder; the render loop must repair it.
  await page.evaluate(() => { document.querySelector<HTMLVideoElement>('.replay-ref-view video')!.currentTime = 0 })
  await expect.poll(() => page.evaluate(() => {
    const userTime = document.querySelector<HTMLVideoElement>('.replay-user-view video')!.currentTime
    const refTime = document.querySelector<HTMLVideoElement>('.replay-ref-view video')!.currentTime
    const poses = window.__clockHarness.poses
    const closest = poses.reduce((best, sample) => Math.abs(sample.videoTime - userTime) < Math.abs(best.videoTime - userTime) ? sample : best)
    return Math.abs(refTime - closest.time)
  })).toBeLessThan(0.18)
  if (manualFrames) {
    await page.evaluate(() => window.__clockHarness.showReplay(true))
    await page.getByRole('button', { name: 'Play', exact: true }).evaluate((button: HTMLButtonElement) => button.click())
    await expect.poll(() => page.evaluate(() => document.querySelector<HTMLVideoElement>('.replay-ref-view video')!.currentTime)).toBeGreaterThan(0.35)
    await page.getByRole('button', { name: 'Pause', exact: true }).evaluate((button: HTMLButtonElement) => button.click())
    await expect.poll(() => page.evaluate(() => document.querySelector<HTMLVideoElement>('.replay-ref-view video')!.paused)).toBe(true)
  }
})
}
