import { afterAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { initializeApp, deleteApp, type FirebaseApp } from 'firebase/app'
import { connectAuthEmulator, getAuth, signInAnonymously } from 'firebase/auth'
import { connectDatabaseEmulator, getDatabase, get, ref, set } from 'firebase/database'
import { createRoom, serveRoom, submitRequest } from '../src/roomService'
import { ROOM_ROOT } from '../src/roomCore'

const apps: FirebaseApp[] = []
const hosts = new Map<string, () => void>()
async function client(authenticate = true) {
  const app = initializeApp({ apiKey: 'fake-api-key', authDomain: 'demo-poker-chips.firebaseapp.com', projectId: 'demo-poker-chips', databaseURL: 'https://demo-poker-chips-default-rtdb.firebaseio.com', appId: 'demo-app' }, randomUUID())
  apps.push(app)
  const auth = getAuth(app), db = getDatabase(app)
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  connectDatabaseEmulator(db, '127.0.0.1', 9000)
  if (authenticate) await signInAnonymously(auth)
  const uid = auth.currentUser?.uid ?? 'unauthenticated'
  const call = async (name: string, data: Record<string, any>): Promise<any> => {
    if (name === 'createRoom') {
      const result = await createRoom(db, uid, data.name, data.actionId)
      if (!hosts.has(result.roomId)) hosts.set(result.roomId, serveRoom(db, uid, result.roomId))
      return result
    }
    if (name === 'joinRoom') return submitRequest(db, uid, data.code, 'joinRoom', {name: data.name}, data.actionId)
    const {roomId, actionId, ...payload} = data
    return submitRequest(db, uid, roomId, 'roomCommand', payload, actionId)
  }
  const room = async (id: string) => (await get(ref(db, `${ROOM_ROOT}/rooms/${id}`))).val()
  const command = async (id: string, type: string, data: object = {}) => call('roomCommand', { roomId: id, type, expectedVersion: (await room(id)).version, actionId: randomUUID(), ...data })
  return { uid: auth.currentUser?.uid, app, db, call, room, command }
}
afterAll(async () => { for (const stop of hosts.values()) stop(); await Promise.all(apps.map(deleteApp)) })

describe('Firebase Spark multiplayer integration', () => {
  it('authenticates independent players, arbitrates seats, protects writes and completes two real hands', async () => {
    const [host, guest, outsider] = await Promise.all([client(), client(), client()])
    const create = { name: 'Host', actionId: randomUUID() }
    const { roomId } = await host.call('createRoom', create)
    expect(await host.call('createRoom', create)).toEqual({ roomId })
    expect(roomId).toMatch(/^\d{6}$/)
    await expect(outsider.room(roomId)).rejects.toBeDefined()
    await expect(outsider.call('roomCommand', { roomId, type: 'start', expectedVersion: 1, actionId: randomUUID() })).rejects.toBeDefined()
    await guest.call('joinRoom', { name: 'Guest', code: roomId, actionId: randomUUID() })
    expect(Object.keys((await host.room(roomId)).members)).toHaveLength(2)
    await expect(set(ref(guest.db, `${ROOM_ROOT}/rooms/${roomId}/members/${guest.uid}/host`), true)).rejects.toBeDefined()
    await expect(set(ref(guest.db, `${ROOM_ROOT}/requests/${roomId}/${host.uid}/forged-action`), {uid: host.uid, actionId: 'forged-action', kind: 'roomCommand', payload: {type: 'start', expectedVersion: 2}, createdAt: Date.now()})).rejects.toBeDefined()
    await expect(host.command(roomId, 'takeSeat', { seat: 1.5 })).rejects.toBeDefined()
    const version = (await host.room(roomId)).version
    const seatRace = await Promise.allSettled([host, guest].map(player => player.call('roomCommand', { roomId, type: 'takeSeat', seat: 1, expectedVersion: version, actionId: randomUUID() })))
    expect(seatRace.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    await host.command(roomId, 'takeSeat', { seat: 0 })
    await guest.command(roomId, 'takeSeat', { seat: 1 })
    await expect(guest.command(roomId, 'settings', { stack: 999, sb: 5, bb: 10 })).rejects.toBeDefined()
    await host.command(roomId, 'settings', { stack: 100, sb: 5, bb: 10 })
    await expect(host.command(roomId, 'start')).rejects.toBeDefined()
    await host.command(roomId, 'ready'); await guest.command(roomId, 'ready'); await host.command(roomId, 'start')
    let room = await host.room(roomId)
    expect(room.game.phase).toBe('waiting-deal')
    await expect(guest.command(roomId, 'deal')).rejects.toBeDefined()
    const dealCommand = { roomId, type: 'deal', expectedVersion: room.version, actionId: randomUUID() }
    await host.call('roomCommand', dealCommand); await host.call('roomCommand', dealCommand)
    room = await host.room(roomId)
    expect(room.game.players[host.uid!].stack).toBe(95); expect(room.game.players[guest.uid!].stack).toBe(90)
    expect(room.game.turn).toBe(host.uid)
    await expect(guest.command(roomId, 'act', { move: { kind: 'fold' } })).rejects.toBeDefined()
    await expect(set(ref(guest.db, `${ROOM_ROOT}/rooms/${roomId}/game/players/${guest.uid}/stack`), 999999)).rejects.toBeDefined()
    await host.command(roomId, 'act', { move: { kind: 'fold' } })
    room = await host.room(roomId)
    expect(room.game.phase).toBe('settled'); expect(room.game.players[host.uid!].stack).toBe(95); expect(room.game.players[guest.uid!].stack).toBe(105)
    await expect(host.command(roomId, 'payout', { winners: [[guest.uid]] })).rejects.toBeDefined()
    await expect(host.command(roomId, 'ready')).rejects.toBeDefined()
    await host.command(roomId, 'nextHand')
    room = await host.room(roomId); expect(room.game.handId).toBe(2); expect(room.game.dealer).toBe(1)
    await guest.command(roomId, 'deal'); await guest.command(roomId, 'act', { move: { kind: 'call' } }); await host.command(roomId, 'act', { move: { kind: 'check' } })
    for (let street = 0; street < 3; street++) {
      await guest.command(roomId, 'reveal')
      await host.command(roomId, 'act', { move: { kind: 'check' } }); await guest.command(roomId, 'act', { move: { kind: 'check' } })
    }
    room = await host.room(roomId); expect(room.game.phase).toBe('showdown')
    await expect(guest.command(roomId, 'payout', { winners: [[guest.uid]] })).rejects.toBeDefined()
    await expect(host.command(roomId, 'payout', { winners: [[host.uid, host.uid]] })).rejects.toBeDefined()
    const pay = { roomId, type: 'payout', expectedVersion: room.version, actionId: randomUUID(), winners: [[host.uid, guest.uid]] }
    await host.call('roomCommand', pay); await host.call('roomCommand', pay)
    room = await host.room(roomId)
    expect(room.game.phase).toBe('settled')
    expect(Object.values(room.game.players).reduce((sum: number, player: any) => sum + player.stack + (player.handBet || 0), 0)).toBe(200)
    expect(room.game.players[host.uid!].stack).toBe(95); expect(room.game.players[guest.uid!].stack).toBe(105)
    hosts.get(roomId)!(); hosts.delete(roomId)
    const queued = guest.command(roomId, 'nextHand')
    hosts.set(roomId, serveRoom(host.db, host.uid!, roomId))
    await expect(queued).rejects.toThrow('Nur der Host')
    await host.command(roomId, 'nextHand')
    expect((await host.room(roomId)).game.handId).toBe(3)
  }, 120000)

  it('rejects unauthenticated and malformed requests without creating state', async () => {
    const [anonymous, player] = await Promise.all([client(false), client()])
    await expect(anonymous.call('createRoom', { name: 'Host', actionId: randomUUID() })).rejects.toBeDefined()
    await expect(player.call('createRoom', { name: 'A', actionId: randomUUID() })).rejects.toBeDefined()
    await expect(player.call('createRoom', { name: 'Host', actionId: '../../invalid' })).rejects.toBeDefined()
    await expect(player.call('joinRoom', { name: 'Guest', code: '12.345', actionId: randomUUID() })).rejects.toBeDefined()
    await expect(player.call('joinRoom', { name: 'Guest', code: '000000', actionId: randomUUID() })).rejects.toBeDefined()
    await expect(player.call('roomCommand', { roomId: '000000', type: 'start', expectedVersion: 1, actionId: randomUUID() })).rejects.toBeDefined()
  }, 30000)
})
