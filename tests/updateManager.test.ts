// @vitest-environment jsdom
import {afterEach, expect, it, vi} from 'vitest'
import {checkForUpdate, updateState} from '../src/updates/updateManager'

afterEach(() => {
  vi.unstubAllGlobals()
  updateState.message = ''
  updateState.available = false
})

it('can retry a manual version check after an offline failure', async () => {
  vi.stubGlobal('navigator', {onLine: false})
  await checkForUpdate()
  expect(updateState.message).toContain('offline')

  const fetchVersion = vi.fn().mockResolvedValue({ok: true, json: async () => ({version: '0.12.0', label: '0.12'})})
  vi.stubGlobal('navigator', {onLine: true})
  vi.stubGlobal('fetch', fetchVersion)
  await checkForUpdate()
  expect(fetchVersion).toHaveBeenCalledOnce()
  expect(updateState.message).toContain('neuesten Stand')
})
