import {describe,expect,it} from 'vitest'
import {isNewerVersion,isPokerCache} from '../src/updates'
describe('Update safeguards',()=>{
  it('compares semantic versions and does not offer stale or malformed versions',()=>{
    expect(isNewerVersion('0.0.2','0.0.1')).toBe(true)
    expect(isNewerVersion('0.0.10','0.0.9')).toBe(true)
    expect(isNewerVersion('0.1.0','0.0.99')).toBe(true)
    for(const value of ['0.0.1','0.0.0','garbage','1.0'])expect(isNewerVersion(value,'0.0.1')).toBe(false)
  })
  it('limits cache repair to Poker Chips rather than other apps on the same origin',()=>{
    const scope='https://hayvan2802.github.io/Poker-Chips-Online/'
    expect(isPokerCache('poker-chips-precache-v2',scope)).toBe(true)
    expect(isPokerCache('workbox-precache-v2-'+scope,scope)).toBe(true)
    expect(isPokerCache('gruppen-spiele-v0.117',scope)).toBe(false)
    expect(isPokerCache('workbox-precache-v2-https://hayvan2802.github.io/Gruppen-Spiele/',scope)).toBe(false)
  })
})
