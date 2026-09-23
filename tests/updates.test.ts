import {describe,expect,it} from 'vitest'
import {isNewerVersion,releasesSince} from '../src/updates'
import releases from '../releases.json'
describe('Update safeguards',()=>{
  it('compares semantic versions and does not offer stale or malformed versions',()=>{
    expect(isNewerVersion('0.0.2','0.0.1')).toBe(true)
    expect(isNewerVersion('0.0.10','0.0.9')).toBe(true)
    expect(isNewerVersion('0.1.0','0.0.99')).toBe(true)
    for(const value of ['0.0.1','0.0.0','garbage','1.0'])expect(isNewerVersion(value,'0.0.1')).toBe(false)
  })
  it('shows only the latest note on first install and all unseen versions after an upgrade',()=>{
    expect(releasesSince(releases,null).map(x=>x.version)).toEqual(['0.0.8'])
    expect(releasesSince(releases,'0.0.5').map(x=>x.version)).toEqual(['0.0.8','0.0.7','0.0.6'])
    expect(releasesSince(releases,'0.0.8')).toEqual([])
  })
})
