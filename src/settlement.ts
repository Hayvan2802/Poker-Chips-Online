import type { RoomState } from './roomCore'

export interface CashResult {uid:string;name:string;chips:number;paidCents:number;valueCents:number;netCents:number}
export interface CashTransfer {from:string;to:string;cents:number}

// Cash tables account for every buy-in and distribute the total paid amount
// over the chips still in play. Largest remainders keep the cent total exact.
export function cashSettlement(room: RoomState): {rows:CashResult[];transfers:CashTransfer[]}|null {
  const game = room.game, buyIns = room.buyIns
  if (!game || !buyIns || !['settled','waiting-deal'].includes(game.phase)) return null
  const players = Object.values(game.players).sort((a,b)=>a.seat-b.seat)
  const totalPaid = players.reduce((sum,p)=>sum+(buyIns[p.uid] || 0),0)
  const totalChips = players.reduce((sum,p)=>sum+p.stack,0)
  if (!Number.isSafeInteger(totalPaid) || !totalChips || !Number.isSafeInteger(totalChips)) return null
  const allocated = players.map(p=>({uid:p.uid, name:p.name, chips:p.stack, paidCents:buyIns[p.uid]||0,
    valueCents:Math.floor(p.stack*totalPaid/totalChips), remainder:p.stack*totalPaid%totalChips}))
  let left = totalPaid-allocated.reduce((sum,p)=>sum+p.valueCents,0)
  for (const p of [...allocated].sort((a,b)=>b.remainder-a.remainder||a.uid.localeCompare(b.uid))) if (left-- > 0) p.valueCents++
  const rows = allocated.map(({remainder: _remainder,...p})=>({...p,netCents:p.valueCents-p.paidCents}))
  const debts = rows.filter(p=>p.netCents<0).map(p=>({uid:p.uid,left:-p.netCents}))
  const credits = rows.filter(p=>p.netCents>0).map(p=>({uid:p.uid,left:p.netCents}))
  const transfers:CashTransfer[] = []
  for (const debt of debts) for (const credit of credits) {
    const cents = Math.min(debt.left,credit.left)
    if (cents) {transfers.push({from:debt.uid,to:credit.uid,cents});debt.left-=cents;credit.left-=cents}
  }
  return {rows,transfers}
}
