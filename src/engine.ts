export const MAX_SEATS = 9
export type Phase = 'waiting-deal'|'preflop'|'waiting-flop'|'flop'|'waiting-turn'|'turn'|'waiting-river'|'river'|'showdown'|'settled'
export interface Player { uid:string; name:string; seat:number; stack:number; folded:boolean; allIn:boolean; roundBet:number; handBet:number; actedAtBet:number }
export interface Pot { amount:number; eligible:string[] }
export interface Game { handId:number; dealer:number; sb:number; bb:number; phase:Phase; turn:string|null; highestBet:number; minRaise:number; players:Record<string,Player>; pots:Pot[]; totalChips:number; paid:boolean }

const seated = (g:Game) => Object.values(g.players).sort((a,b)=>a.seat-b.seat)
export const next = (g:Game, seat:number, predicate=(p:Player)=>!p.folded&&!p.allIn&&p.stack>0) => {
  const ps=seated(g); for(let n=1;n<=MAX_SEATS;n++){const p=ps.find(x=>x.seat===(seat+n)%MAX_SEATS);if(p&&predicate(p))return p} return undefined
}
export function createGame(players:Array<Pick<Player,'uid'|'name'|'seat'>>, stack:number, sb:number, bb:number, dealer:number):Game {
  if(players.length<2||players.length>MAX_SEATS||!Number.isInteger(stack)||stack<=0||sb<=0||sb>=bb) throw Error('Ungültige Spieleinstellungen')
  const map=Object.fromEntries(players.map(p=>[p.uid,{...p,stack,folded:false,allIn:false,roundBet:0,handBet:0,actedAtBet:-1}]))
  return {handId:1,dealer,sb,bb,phase:'waiting-deal',turn:null,highestBet:0,minRaise:bb,players:map,pots:[],totalChips:stack*players.length,paid:false}
}
function commit(p:Player, amount:number){const paid=Math.min(amount,p.stack);p.stack-=paid;p.roundBet+=paid;p.handBet+=paid;p.allIn=p.stack===0;return paid}
export function deal(g:Game){
  if(g.phase!=='waiting-deal')throw Error('Die Karten wurden bereits bestätigt')
  const dealer=seated(g).find(p=>p.seat===g.dealer);if(!dealer)throw Error('Dealer fehlt')
  const heads=seated(g).filter(p=>p.stack>0).length===2
  const small=heads?dealer:next(g,g.dealer,p=>p.stack>0)!; const big=next(g,small.seat,p=>p.stack>0)!
  commit(small,g.sb);commit(big,g.bb);g.highestBet=Math.max(small.roundBet,big.roundBet);g.phase='preflop'
  g.turn=heads?small.uid:next(g,big.seat)?.uid??null; return g
}
export type Move={kind:'fold'|'check'|'call'|'bet'|'raise'|'all-in';to?:number}
export function act(g:Game,uid:string,move:Move){
  if(g.turn!==uid)throw Error('Du bist nicht am Zug');const p=g.players[uid];const before=g.highestBet
  if(move.kind==='fold')p.folded=true
  else if(move.kind==='check'){if(p.roundBet!==before)throw Error('Check ist nicht möglich')}
  else {const target=move.kind==='call'?Math.min(before,p.roundBet+p.stack):move.kind==='all-in'?p.roundBet+p.stack:move.to??0
    if(target<=p.roundBet||target>p.roundBet+p.stack)throw Error('Ungültiger Betrag')
    const raise=target-before
    if(target>before&&raise<g.minRaise&&target!==p.roundBet+p.stack)throw Error(`Mindesterhöhung ist ${before+g.minRaise}`)
    commit(p,target-p.roundBet);if(target>before){g.highestBet=target;if(raise>=g.minRaise)g.minRaise=raise}
  } p.actedAtBet=before
  const live=seated(g).filter(x=>!x.folded);if(live.length===1){g.turn=null;g.phase='showdown';return g}
  const pending=live.filter(x=>!x.allIn&&x.stack>0&&(x.roundBet<g.highestBet||x.actedAtBet<g.highestBet))
  if(!pending.length){g.turn=null;advanceRound(g)} else g.turn=next(g,p.seat,x=>pending.includes(x))?.uid??pending[0].uid
  return g
}
function advanceRound(g:Game){for(const p of seated(g)){p.roundBet=0;p.actedAtBet=-1}g.highestBet=0;g.minRaise=g.bb;const map:Record<string,Phase>={preflop:'waiting-flop',flop:'waiting-turn',turn:'waiting-river',river:'showdown'};g.phase=map[g.phase]??g.phase}
export function reveal(g:Game){const map:Record<string,Phase>={'waiting-flop':'flop','waiting-turn':'turn','waiting-river':'river'};const phase=map[g.phase];if(!phase)throw Error('Keine Karten aufzudecken');g.phase=phase;g.turn=next(g,g.dealer)?.uid??null;if(!g.turn)advanceRound(g);return g}
export function buildPots(g:Game):Pot[]{const levels=[...new Set(seated(g).map(p=>p.handBet).filter(Boolean))].sort((a,b)=>a-b);let prev=0;return levels.map(level=>{const contributors=seated(g).filter(p=>p.handBet>=level);const pot={amount:(level-prev)*contributors.length,eligible:contributors.filter(p=>!p.folded).map(p=>p.uid)};prev=level;return pot}).filter(p=>p.amount>0)}
export function payout(g:Game,winners:string[][]){if(g.paid)throw Error('Bereits ausgezahlt');const pots=buildPots(g);if(winners.length!==pots.length)throw Error('Für jeden Pot Gewinner wählen');pots.forEach((pot,i)=>{const ws=winners[i].filter(id=>pot.eligible.includes(id));if(!ws.length)throw Error('Nicht berechtigter Gewinner');const share=Math.floor(pot.amount/ws.length),rest=pot.amount%ws.length;ws.forEach(id=>g.players[id].stack+=share);const order=seated(g).filter(p=>ws.includes(p.uid)&&p.seat>g.dealer).concat(seated(g).filter(p=>ws.includes(p.uid)&&p.seat<=g.dealer));for(let n=0;n<rest;n++)g.players[order[n].uid].stack++});g.pots=pots;g.paid=true;g.phase='settled';if(seated(g).reduce((s,p)=>s+p.stack,0)!==g.totalChips)throw Error('Chip-Erhaltung verletzt');return g}
