// @vitest-environment jsdom
import {afterEach,describe,expect,it,vi} from 'vitest'
import {isGameRoute} from '../src/updates/routeSafety'
import {installUpdate,updateState} from '../src/updates/updateManager'
import {isOlderPrecache,precacheRelease} from '../src/updates/cacheSafety'

afterEach(()=>{vi.unstubAllGlobals();updateState.installing=false;updateState.available=false;updateState.message=''})

describe('update route safety',()=>{
  it.each(['/local','/local/','/LOCAL','/LoCaL/','/room/123456','/Room/123456/','/ROOM/123456/display/'])('blocks router and Pages route %s',path=>{
    expect(isGameRoute(path)).toBe(true)
    expect(isGameRoute('/Poker-Chips-Online'+path,'/Poker-Chips-Online/')).toBe(true)
  })
  it.each(['/','/local-setup','/roommate','/other/local'])('permits menu/non-table route %s',path=>expect(isGameRoute(path)).toBe(false))
  it.each(['/local/','/LOCAL','/Room/123456/'])('never starts worker activation or reload on %s',async pathname=>{
    const reload=vi.fn(),getRegistration=vi.fn()
    vi.stubGlobal('location',{pathname,reload})
    vi.stubGlobal('navigator',{serviceWorker:{getRegistration}})
    updateState.available=true
    await installUpdate()
    expect(getRegistration).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
    expect(updateState.installing).toBe(false)
    expect(updateState.message).toContain('Hauptmenü')
  })
})

describe('scope and release boundaries for retained worker caches',()=>{
  const scope='https://example.test/Poker-Chips-Online/'
  const cache=(version:string,base=scope)=>`poker-chips-v${version}-precache-v2-${base}`
  it('recognizes public and legacy caches only in this exact registration scope',()=>{
    expect(precacheRelease(cache('0.12'),scope)).toBe(12)
    expect(precacheRelease(cache('0.0.9'),scope)).toBe(9)
    expect(precacheRelease(cache('0.12','https://example.test/another/'),scope)).toBeNull()
    expect(precacheRelease(`other-${cache('0.12')}`,scope)).toBeNull()
    expect(precacheRelease(cache('unknown'),scope)).toBeNull()
  })
  it('deletes only older releases, preserving current and installing future precaches',()=>{
    expect(isOlderPrecache(cache('0.0.9'),scope,'0.12')).toBe(true)
    expect(isOlderPrecache(cache('0.11'),scope,'0.12')).toBe(true)
    expect(isOlderPrecache(cache('0.12'),scope,'0.12')).toBe(false)
    expect(isOlderPrecache(cache('0.13'),scope,'0.12')).toBe(false)
    expect(isOlderPrecache(cache('0.100'),scope,'0.12')).toBe(false)
    expect(isOlderPrecache(cache('0.1'),scope,'invalid')).toBe(false)
  })
})
