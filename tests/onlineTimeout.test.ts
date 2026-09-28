import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import type {Database} from 'firebase/database'

const database = vi.hoisted(() => ({get:vi.fn(), set:vi.fn(), remove:vi.fn(), onValue:vi.fn()}))
vi.mock('firebase/database', () => ({
  ...database,
  ref: (_db:unknown, path:string) => ({path}),
  serverTimestamp: () => 1,
  runTransaction: vi.fn(),
}))
import {submitRequest} from '../src/online/roomService'

function deferred<T>() {
  let resolve!: (value:T) => void
  let reject!: (error:Error) => void
  const promise = new Promise<T>((done, fail) => {resolve=done;reject=fail})
  return {promise,resolve,reject}
}
const snapshot = (value:unknown=null) => ({val:()=>value})
const payload = {type:'ready',expectedVersion:1}
const request = {uid:'player',actionId:'timeout-action',kind:'roomCommand',payload,createdAt:1}
const response = {ok:true,version:2,fingerprint:JSON.stringify(['roomCommand',{expectedVersion:1,type:'ready'}])}
const submit = (db={} as Database) => submitRequest(db,'player','123456','roomCommand',payload,'timeout-action')
const listeners: Array<{callback:(value:ReturnType<typeof snapshot>)=>void; stop:ReturnType<typeof vi.fn>}> = []

beforeEach(() => {
  vi.useFakeTimers()
  vi.resetAllMocks()
  listeners.length = 0
  database.onValue.mockImplementation((reference, callback) => {
    const stop = vi.fn()
    if(reference.path === '.info/connected')setTimeout(() => callback(snapshot(true)),0)
    else listeners.push({callback,stop})
    return stop
  })
  database.set.mockResolvedValue(undefined)
  database.remove.mockResolvedValue(undefined)
})
afterEach(() => vi.useRealTimers())

describe('online request deadlines across connectivity loss', () => {
  it.each(['response','request'])('times out a pending %s read and never writes after it completes late',async stage => {
    const read = deferred<ReturnType<typeof snapshot>>()
    if(stage==='request')database.get.mockResolvedValueOnce(snapshot())
    database.get.mockReturnValueOnce(read.promise)
    const timedOut = expect(submit()).rejects.toThrow('Bestätigung vom Host fehlt')
    await vi.advanceTimersByTimeAsync(30000)
    await timedOut
    read.resolve(snapshot())
    await vi.advanceTimersByTimeAsync(0)
    expect(database.set).not.toHaveBeenCalled()
    expect(database.remove).not.toHaveBeenCalled()
  })

  it('bounds the receipt lookup for a cached v0.12 response',async () => {
    database.get.mockResolvedValueOnce(snapshot({ok:true,version:2})).mockReturnValueOnce(new Promise(()=>{}))
    const timedOut = expect(submit()).rejects.toThrow('Bestätigung vom Host fehlt')
    await vi.advanceTimersByTimeAsync(30000)
    await timedOut
    expect(database.get).toHaveBeenCalledTimes(2)
    expect(database.set).not.toHaveBeenCalled()
  })

  it('does not remove a shared request when its write acknowledgement arrives after the timeout',async () => {
    const write = deferred<void>()
    database.get.mockResolvedValue(snapshot())
    database.set.mockReturnValueOnce(write.promise)
    const timedOut = expect(submit()).rejects.toThrow('Bestätigung vom Host fehlt')
    await vi.advanceTimersByTimeAsync(30000)
    await timedOut
    expect(database.set).toHaveBeenCalledTimes(1)
    write.resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(database.remove).not.toHaveBeenCalled()
    expect(database.onValue).toHaveBeenCalledTimes(1)
  })

  it('does not remove another tab’s conflicting request when a delayed write is denied',async () => {
    const write = deferred<void>()
    database.get.mockResolvedValueOnce(snapshot()).mockResolvedValueOnce(snapshot()).mockResolvedValueOnce(snapshot({
      uid:'player',kind:'roomCommand',payload:{type:'takeSeat',seat:2,expectedVersion:1},
    }))
    database.set.mockReturnValueOnce(write.promise)
    const timedOut = expect(submit()).rejects.toThrow('Bestätigung vom Host fehlt')
    await vi.advanceTimersByTimeAsync(30000)
    await timedOut
    write.reject(Error('Permission denied'))
    await vi.advanceTimersByTimeAsync(0)
    expect(database.get).toHaveBeenCalledTimes(2)
    expect(database.remove).not.toHaveBeenCalled()
  })

  it.each(['request','response'])('stops recovery after a denied write when the %s lookup outlives the deadline',async stage => {
    const read = deferred<ReturnType<typeof snapshot>>()
    database.get.mockResolvedValueOnce(snapshot()).mockResolvedValueOnce(snapshot())
    if(stage==='response')database.get.mockResolvedValueOnce(snapshot())
    database.get.mockReturnValueOnce(read.promise)
    database.set.mockRejectedValueOnce(Error('Permission denied'))
    const timedOut = expect(submit()).rejects.toThrow('Bestätigung vom Host fehlt')
    await vi.advanceTimersByTimeAsync(30000)
    await timedOut
    const reads = database.get.mock.calls.length
    read.resolve(snapshot(stage==='response'?{ok:true,version:2}:null))
    await vi.advanceTimersByTimeAsync(0)
    expect(database.get).toHaveBeenCalledTimes(reads)
    expect(database.set).toHaveBeenCalledTimes(1)
    expect(database.remove).not.toHaveBeenCalled()
    expect(listeners).toHaveLength(0)
  })

  it('keeps an identical request available to a second client after the first client times out',async () => {
    database.get.mockImplementation(reference => Promise.resolve(snapshot(reference.path.includes('/requests/')?request:null)))
    const firstTimeout = expect(submit()).rejects.toThrow('Bestätigung vom Host fehlt')
    await vi.advanceTimersByTimeAsync(10000)
    const second = submit()
    await vi.advanceTimersByTimeAsync(20000)
    await firstTimeout
    expect(listeners).toHaveLength(2)
    expect(listeners[0].stop).toHaveBeenCalledTimes(1)
    expect(listeners[1].stop).not.toHaveBeenCalled()
    expect(database.set).not.toHaveBeenCalled()
    expect(database.remove).not.toHaveBeenCalled()
    listeners[1].callback(snapshot(response))
    await expect(second).resolves.toEqual({roomId:'123456',version:2})
    expect(listeners[1].stop).toHaveBeenCalledTimes(1)
    // An already-dispatched callback must not start a legacy receipt read.
    const reads = database.get.mock.calls.length
    listeners[0].callback(snapshot({ok:true,version:2}))
    await vi.advanceTimersByTimeAsync(0)
    expect(database.get).toHaveBeenCalledTimes(reads)
  })

  it('releases the pending action after timeout without letting its late read disturb the retry',async () => {
    const db = {} as Database, read = deferred<ReturnType<typeof snapshot>>()
    database.get.mockReturnValueOnce(read.promise).mockResolvedValue(snapshot())
    const firstTimeout = expect(submit(db)).rejects.toThrow('Bestätigung vom Host fehlt')
    await vi.advanceTimersByTimeAsync(30000)
    await firstTimeout
    const retry = submit(db)
    await vi.advanceTimersByTimeAsync(0)
    expect(database.set).toHaveBeenCalledTimes(1)
    read.resolve(snapshot())
    await vi.advanceTimersByTimeAsync(0)
    const sameRetry = submit(db)
    await vi.advanceTimersByTimeAsync(0)
    expect(database.get).toHaveBeenCalledTimes(3)
    expect(database.set).toHaveBeenCalledTimes(1)
    expect(database.remove).not.toHaveBeenCalled()
    expect(listeners).toHaveLength(1)
    listeners[0].callback(snapshot(response))
    await expect(Promise.all([retry,sameRetry])).resolves.toEqual([
      {roomId:'123456',version:2},{roomId:'123456',version:2},
    ])
  })

  it('waits for an identical request from another client when its own racing write is denied',async () => {
    database.get.mockResolvedValueOnce(snapshot()).mockResolvedValueOnce(snapshot()).mockResolvedValueOnce(snapshot(request))
    database.set.mockRejectedValueOnce(Error('Permission denied'))
    const result = submit()
    await vi.advanceTimersByTimeAsync(0)
    expect(listeners).toHaveLength(1)
    listeners[0].callback(snapshot(response))
    await expect(result).resolves.toEqual({roomId:'123456',version:2})
    expect(database.remove).not.toHaveBeenCalled()
  })

  it('stops an immediate connection subscription and leaves no listener after a cached response',async () => {
    const stop = vi.fn()
    database.onValue.mockImplementation((_reference, callback) => {callback(snapshot(true));return stop})
    database.get.mockResolvedValueOnce(snapshot(response))
    await expect(submit()).resolves.toEqual({roomId:'123456',version:2})
    expect(stop).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
    expect(database.set).not.toHaveBeenCalled()
  })
})
