import {describe,expect,it} from 'vitest'
import {isNewerVersion,releasesSince} from '../src/updates/updates'
import releases from '../releases.json'
describe('Update safeguards',()=>{
  it('compares public, npm, and legacy versions by the same release number',()=>{
    expect(isNewerVersion('0.2','0.1')).toBe(true)
    expect(isNewerVersion('0.10','0.9')).toBe(true)
    expect(isNewerVersion('0.12.0','0.0.11')).toBe(true)
    expect(isNewerVersion('0.1.0','0.0.99')).toBe(false)
    for(const value of ['0.0.1','0.0.0','garbage','1.0'])expect(isNewerVersion(value,'0.1')).toBe(false)
  })
  it('shows only the latest note on first install and migrates a legacy seen-version',()=>{
    expect(releasesSince(releases,null).map(x=>x.version)).toEqual(['0.12'])
    expect(releasesSince(releases,'0.0.5').map(x=>x.version)).toEqual(['0.12','0.11','0.10','0.9','0.8','0.7','0.6'])
    expect(releasesSince(releases,releases[0].version)).toEqual([])
  })
})
