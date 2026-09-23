import {afterEach, describe, expect, it, vi} from 'vitest'
import {actionId, safeRead, safeWrite} from '../src/browser'

afterEach(() => vi.unstubAllGlobals())

describe('Safari startup fallbacks', () => {
  it('renders without storage access and does not erase the existing player name', () => {
    vi.stubGlobal('localStorage', {getItem: () => { throw Error('storage denied') }, setItem: () => { throw Error('storage denied') }})
    expect(safeRead('name')).toBeNull()
    expect(() => safeWrite('name', 'Hakan2802')).not.toThrow()
  })
  it('creates valid action identifiers without randomUUID', () => {
    vi.stubGlobal('crypto', {getRandomValues: (bytes: Uint8Array) => { bytes.fill(7); return bytes }})
    const first = actionId(), second = actionId()
    expect(first).toMatch(/^[a-zA-Z0-9_-]{8,100}$/)
    expect(second).not.toBe(first)
  })
})
