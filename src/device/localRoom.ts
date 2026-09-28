import {applyRequest,applyTurnTimeout,newRoom,cleanName,type RoomState,type RoomRequest} from '../game/roomCore'
import {actionId} from './browser'
import {isLocalRoom} from './localRoomValidation'

const KEY='poker-chips-local-table-v1'
export function inspectLocalRoom(): {room: RoomState|null; invalid: string|null; unavailable: boolean} {
  let raw: string|null
  try { raw = localStorage.getItem(KEY) } catch { return {room:null,invalid:null,unavailable:true} }
  if (raw === null) return {room:null,invalid:null,unavailable:false}
  try {
    const value: unknown = JSON.parse(raw)
    if (isLocalRoom(value)) return {room:value,invalid:null,unavailable:false}
  } catch { /* Keep the original bytes available for recovery. */ }
  return {room:null,invalid:raw,unavailable:false}
}
export function readLocalRoom():RoomState|null { return inspectLocalRoom().room }
export function saveLocalRoom(room:RoomState) {try{localStorage.setItem(KEY,JSON.stringify(room))}catch{ /* Current session stays playable. */ }}
export function clearLocalRoom(){try{localStorage.removeItem(KEY)}catch{}}
export function createLocalRoom(names:string[],settings:{stack:number;sb:number;bb:number;blindMinutes:number;blindMultiplier:number}) {
  if (inspectLocalRoom().invalid !== null) throw Error('Bitte sichere oder lösche zuerst den beschädigten Spielstand.')
  if(names.length<2||names.length>9)throw Error('Wähle 2 bis 9 Spieler')
  const cleaned=names.map(cleanName)
  let room=newRoom('000000','local-0',cleaned[0],actionId())
  for(let index=1;index<cleaned.length;index++) room=applyRequest(room,{uid:`local-${index}`,actionId:actionId(),kind:'joinRoom',createdAt:Date.now(),payload:{name:cleaned[index]}})
  room=localCommand(room,'local-0','settings',settings)
  for(let index=0;index<cleaned.length;index++)room=localCommand(room,`local-${index}`,'ready')
  room=localCommand(room,'local-0','start')
  saveLocalRoom(room);return room
}
export function localCommand(room:RoomState,uid:string,type:string,data:Record<string,unknown>={},now=Date.now()){
  const request:RoomRequest={uid,actionId:actionId(),kind:'roomCommand',createdAt:now,payload:{type,expectedVersion:room.version,...data}}
  const next=applyRequest(room,request,now);saveLocalRoom(next);return next
}
export function localTick(room:RoomState,now=Date.now()) {const next=applyTurnTimeout(room,now);if(next)saveLocalRoom(next);return next||room}
