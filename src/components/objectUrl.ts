/**
 * One object URL per Blob. set() with the same blob returns the same URL;
 * a new blob (or null) revokes the previous URL first, so the recording clip
 * shared by the results screen and the replay never leaks blob: URLs.
 */
export interface ObjectUrlSlot {
  /** Current URL for `blob` (created once per blob); null clears and revokes. */
  set(blob: Blob | null): string | null
  readonly url: string | null
  /** Revoke the current URL (e.g. on unmount). */
  dispose(): void
}

export function createObjectUrlSlot(
  create: (blob: Blob) => string = (blob) => URL.createObjectURL(blob),
  revoke: (url: string) => void = (url) => URL.revokeObjectURL(url),
): ObjectUrlSlot {
  let currentBlob: Blob | null = null
  let currentUrl: string | null = null

  const dispose = () => {
    if (currentUrl) revoke(currentUrl)
    currentBlob = null
    currentUrl = null
  }

  return {
    set(blob) {
      if (blob === currentBlob) return currentUrl
      dispose()
      if (blob) {
        currentBlob = blob
        currentUrl = create(blob)
      }
      return currentUrl
    },
    get url() {
      return currentUrl
    },
    dispose,
  }
}
