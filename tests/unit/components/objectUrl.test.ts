import { describe, it, expect, vi } from 'vitest'
import { createObjectUrlSlot } from '../../../src/components/objectUrl'

function setup() {
  let n = 0
  const create = vi.fn(() => `blob:test/${++n}`)
  const revoke = vi.fn()
  return { slot: createObjectUrlSlot(create, revoke), create, revoke }
}

describe('createObjectUrlSlot', () => {
  it('creates one URL per blob, however often it is asked', () => {
    const { slot, create, revoke } = setup()
    const blob = new Blob(['a'])
    expect(slot.set(blob)).toBe('blob:test/1')
    expect(slot.set(blob)).toBe('blob:test/1')
    expect(slot.url).toBe('blob:test/1')
    expect(create).toHaveBeenCalledTimes(1)
    expect(revoke).not.toHaveBeenCalled()
  })

  it('revokes the previous URL when the blob changes or is cleared', () => {
    const { slot, revoke } = setup()
    slot.set(new Blob(['a']))
    expect(slot.set(new Blob(['b']))).toBe('blob:test/2')
    expect(revoke).toHaveBeenCalledWith('blob:test/1')
    expect(slot.set(null)).toBeNull()
    expect(revoke).toHaveBeenCalledWith('blob:test/2')
    expect(slot.url).toBeNull()
  })

  it('dispose() revokes the current URL once; clearing an empty slot is a no-op', () => {
    const { slot, create, revoke } = setup()
    expect(slot.set(null)).toBeNull()
    expect(create).not.toHaveBeenCalled()
    const blob = new Blob(['a'])
    slot.set(blob)
    slot.dispose()
    slot.dispose()
    expect(revoke).toHaveBeenCalledTimes(1)
    // The same blob after dispose gets a fresh URL
    expect(slot.set(blob)).toBe('blob:test/2')
  })
})
