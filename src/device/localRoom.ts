import {applyRequest,applyTurnTimeout,newRoom,cleanName,type RoomState,type RoomRequest} from '../game/roomCore'
import {actionId} from './browser'

const KEY='poker-chips-local-table-v1'
export function readLocalRoom():RoomState|null {
  try {const value=JSON.parse(localStorage.getItem(KEY)||'null') as RoomState|null
    if(value?.code==='000000'&&value.hostUid==='local-0'&&value.status==='playing'&&value.members&&value.game?.players&&value.settings&&Number.isSafeInteger(value.version)&&value.version>0)return value
  } catch { /* Corrupt or blocked storage must not blank the page. */ }
  return null
}
export function saveLocalRoom(room:RoomState) {try{localStorage.setItem(KEY,JSON.stringify(room))}catch{ /* Current session stays playable. */ }}
export function clearLocalRoom(){try{localStorage.removeItem(KEY)}catch{}}
export function createLocalRoom(names:string[],settings:{stack:number;sb:number;bb:number;blindMinutes:number;blindMultiplier:number}) {
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
