import {assertChips,type Game} from '../game/engine'
import {validBlindPlan,validDenominations} from '../game/blinds'
import type {RoomState} from '../game/roomCore'

type Data = Record<string, any>
const object = (value: unknown): value is Data => !!value && typeof value === 'object' && !Array.isArray(value)
const integer = (value: unknown, minimum = 0): value is number => Number.isSafeInteger(value) && (value as number) >= minimum
const optional = (value: unknown, check: (value: any) => boolean) => value === undefined || check(value)
const seat = (value: unknown) => integer(value) && value < 9
const name = (value: unknown) => typeof value === 'string' && value.trim().length >= 2 && value.trim().length <= 24
const bool = (value: unknown) => typeof value === 'boolean'
const phases = ['waiting-deal','preflop','waiting-flop','flop','waiting-turn','turn','waiting-river','river','showdown','settled']

function validGame(value: unknown, members: Data): value is Game {
  if (!object(value) || !object(value.players)) return false
  const entries = Object.entries(value.players)
  if (entries.length < 2 || entries.length > 9 || entries.length !== Object.keys(members).length) return false
  if (!entries.every(([uid, player]) => object(player) && player.uid === uid && name(player.name)
    && object(members[uid]) && members[uid].seat === player.seat && seat(player.seat)
    && ['stack','roundBet','handBet'].every(key => integer(player[key])) && integer(player.actedAtBet, -1)
    && bool(player.folded) && bool(player.allIn) && optional(player.sittingOut, bool))) return false
  if (new Set(entries.map(([,player]) => player.seat)).size !== entries.length) return false
  if (!integer(value.handId, 1) || !seat(value.dealer)
    || !integer(value.sb, 1) || !integer(value.bb, 2) || value.sb >= value.bb
    || !integer(value.highestBet) || !integer(value.minRaise, 1) || !integer(value.totalChips, 1)
    || !phases.includes(value.phase) || !bool(value.paid) || (value.paid !== (value.phase === 'settled'))
    || (value.turn !== null && (typeof value.turn !== 'string' || !Object.prototype.hasOwnProperty.call(value.players, value.turn)))
    || !optional(value.ante, integer) || !optional(value.anteMode, mode => ['each','bb'].includes(mode))
    || !optional(value.smallBlindSeat, seat) || !optional(value.bigBlindSeat, seat) || !optional(value.previousBigBlindSeat, seat) || !optional(value.pendingDealerSeat, seat)
    || !Array.isArray(value.pots) || !value.pots.every((pot: unknown) => object(pot) && integer(pot.amount)
      && Array.isArray(pot.eligible) && pot.eligible.every((uid: unknown) => typeof uid === 'string' && Object.prototype.hasOwnProperty.call(value.players, uid)))) return false
  if (value.turn !== null) {
    const player = value.players[value.turn]
    if (!['preflop','flop','turn','river'].includes(value.phase) || player.folded || player.allIn || player.sittingOut || !player.stack) return false
  }
  try { assertChips(value as Game); return true } catch { return false }
}

function validSession(value: unknown): boolean {
  return object(value) && integer(value.handsCompleted) && integer(value.biggestPot) && object(value.winners)
    && Object.values(value.winners).every(winner => object(winner) && integer(winner.hands) && integer(winner.chips))
}

// Storage is untrusted input: validate every nested shape used by rendering or commands.
// Older saves may omit optional fields; no valid save is rewritten during inspection.
export function isLocalRoom(value: unknown): value is RoomState {
  if (!object(value) || value.code !== '000000' || value.hostUid !== 'local-0' || value.status !== 'playing'
    || !integer(value.version, 1) || !integer(value.createdAt) || typeof value.name !== 'string'
    || typeof value.creationAction !== 'string' || !object(value.settings) || !object(value.members)) return false
  const settings = value.settings
  if (!integer(settings.stack, 1) || !integer(settings.sb, 1) || !integer(settings.bb, 2) || settings.sb >= settings.bb
    || !optional(settings.blindMinutes, minutes => integer(minutes) && minutes <= 180)
    || !optional(settings.blindMultiplier, multiplier => typeof multiplier === 'number' && Number.isFinite(multiplier) && multiplier > 1 && multiplier <= 10)
    || !optional(settings.ante, integer) || !optional(settings.anteMode, mode => ['each','bb'].includes(mode))
    || !optional(settings.blindPlan, plan => validBlindPlan(plan, settings as {sb:number;bb:number}))
    || !optional(settings.denominations, validDenominations) || !optional(settings.buyInCents, integer)) return false
  if (!object(value.members['local-0']) || !value.members['local-0'].host
    || !Object.entries(value.members).every(([uid,member]) => /^local-[0-8]$/.test(uid) && object(member)
      && member.uid === uid && name(member.name) && seat(member.seat) && bool(member.host) && bool(member.ready)
      && optional(member.timeBank, integer) && optional(member.sittingOut, bool))
    || !validGame(value.game, value.members)) return false
  if (!optional(value.pausedAt, integer) || !optional(value.joinOpen, bool) || !optional(value.lateRegistration, bool)
    || !optional(value.turnClock, clock => object(clock) && clock.uid === value.game.turn && integer(clock.deadline))
    || !optional(value.blindClock, clock => object(clock) && integer(clock.level, 1) && integer(clock.nextIncreaseAt) && optional(clock.breakUntil, integer))
    || !optional(value.session, validSession)
    || !optional(value.lastPayout, payout => object(payout) && integer(payout.handId, 1) && validGame(payout.game, value.members) && optional(payout.session, validSession))) return false
  for (const key of ['buyIns','boughtChips']) {
    if (!optional(value[key], map => object(map) && Object.values(map).every(amount => integer(amount)))) return false
  }
  for (const key of ['processed','history']) {
    if (!optional(value[key], map => object(map) && Object.values(map).every(entry => object(entry) && integer(entry.version, 1)))) return false
  }
  return true
}
