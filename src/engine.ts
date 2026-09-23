export const MAX_SEATS = 9
export type Phase = 'waiting-deal'|'preflop'|'waiting-flop'|'flop'|'waiting-turn'|'turn'|'waiting-river'|'river'|'showdown'|'settled'
export interface Player { uid:string; name:string; seat:number; stack:number; folded:boolean; allIn:boolean; roundBet:number; handBet:number; actedAtBet:number; sittingOut?:boolean }
export interface Pot { amount:number; eligible:string[] }
export interface Game { handId:number; dealer:number; sb:number; bb:number; phase:Phase; turn:string|null; highestBet:number; minRaise:number; players:Record<string,Player>; pots:Pot[]; totalChips:number; paid:boolean }
export type Move={kind:'fold'|'check'|'call'|'bet'|'raise'|'all-in';to?:number}

const seated = (g:Game) => Object.values(g.players).sort((a,b)=>a.seat-b.seat)
const active = (p:Player) => !p.sittingOut && !p.folded && !p.allIn && p.stack>0
const integer = (n:number) => Number.isSafeInteger(n) && n>=0
export const next = (g:Game, seat:number, predicate=active) => {
  const ps=seated(g)
  for(let n=1;n<=MAX_SEATS;n++){const p=ps.find(x=>x.seat===(seat+n)%MAX_SEATS);if(p&&predicate(p))return p}
  return undefined
}
export function assertChips(g:Game){
  const ps=seated(g)
  if(ps.some(p=>![p.stack,p.handBet,p.roundBet].every(integer)||p.roundBet>p.handBet)
    ||ps.reduce((sum,p)=>sum+p.stack+p.handBet,0)!==g.totalChips)throw Error('Chip-Erhaltung verletzt')
}
export function createGame(players:Array<Pick<Player,'uid'|'name'|'seat'>>, stack:number, sb:number, bb:number, dealer:number):Game {
  if(players.length<2||players.length>MAX_SEATS||![stack,sb,bb].every(integer)||stack<=0||sb<=0||sb>=bb
    ||players.some(p=>!p.uid||!Number.isInteger(p.seat)||p.seat<0||p.seat>=MAX_SEATS)
    ||new Set(players.map(p=>p.uid)).size!==players.length||new Set(players.map(p=>p.seat)).size!==players.length
    ||!players.some(p=>p.seat===dealer)||!Number.isSafeInteger(stack*players.length))throw Error('Ungültige Spieleinstellungen')
  const map=Object.fromEntries(players.map(p=>[p.uid,{...p,stack,folded:false,allIn:false,roundBet:0,handBet:0,actedAtBet:-1}]))
  return {handId:1,dealer,sb,bb,phase:'waiting-deal',turn:null,highestBet:0,minRaise:bb,players:map,pots:[],totalChips:stack*players.length,paid:false}
}
function commit(p:Player, amount:number){const paid=Math.min(amount,p.stack);p.stack-=paid;p.roundBet+=paid;p.handBet+=paid;p.allIn=p.stack===0;return paid}
function advanceRound(g:Game){
  for(const p of seated(g)){p.roundBet=0;p.actedAtBet=-1}
  g.highestBet=0;g.minRaise=g.bb;g.turn=null
  const map:Partial<Record<Phase,Phase>>={preflop:'waiting-flop',flop:'waiting-turn',turn:'waiting-river',river:'showdown'}
  const phase=map[g.phase];if(!phase)throw Error('Keine laufende Wettrunde');g.phase=phase
}
function assignTurn(g:Game,after:number){
  const able=seated(g).filter(active)
  const pending=able.filter(p=>p.roundBet<g.highestBet||p.actedAtBet<g.highestBet||p.actedAtBet<0)
  if(!pending.length||(able.length===1&&able[0].roundBet>=g.highestBet))advanceRound(g)
  else g.turn=next(g,after,p=>pending.includes(p))!.uid
}
export function deal(g:Game){
  if(g.phase!=='waiting-deal'||g.paid)throw Error('Die Karten wurden bereits bestätigt')
  const playing=seated(g).filter(p=>p.stack>0&&!p.sittingOut)
  if(playing.length<2)throw Error('Mindestens zwei Spieler müssen aktiv sein')
  let dealer=playing.find(p=>p.seat===g.dealer)
  if(!dealer){dealer=next(g,g.dealer,p=>p.stack>0&&!p.sittingOut);if(!dealer)throw Error('Dealer fehlt');g.dealer=dealer.seat}
  const heads=playing.length===2
  const small=heads?dealer:next(g,g.dealer,p=>p.stack>0&&!p.sittingOut)!;const big=next(g,small.seat,p=>p.stack>0&&!p.sittingOut)!
  commit(small,g.sb);commit(big,g.bb);g.highestBet=Math.max(small.roundBet,big.roundBet);g.phase='preflop'
  assignTurn(g,big.seat);assertChips(g);return g
}
export function act(g:Game,uid:string,move:Move){
  if(!['preflop','flop','turn','river'].includes(g.phase)||g.paid)throw Error('Keine laufende Wettrunde')
  if(g.turn!==uid||!g.players[uid]||!active(g.players[uid]))throw Error('Du bist nicht am Zug')
  if(!move||!['fold','check','call','bet','raise','all-in'].includes(move.kind))throw Error('Ungültige Aktion')
  const p=g.players[uid],before=g.highestBet
  if(move.kind==='fold')p.folded=true
  else if(move.kind==='check'){if(p.roundBet!==before)throw Error('Check ist nicht möglich')}
  else {
    if(move.kind==='bet'&&before!==0)throw Error('Bitte erhöhen statt setzen')
    if(move.kind==='raise'&&before===0)throw Error('Bitte setzen statt erhöhen')
    const target=move.kind==='call'?Math.min(before,p.roundBet+p.stack):move.kind==='all-in'?p.roundBet+p.stack:move.to
    if(target===undefined||!integer(target)||target<=p.roundBet||target>p.roundBet+p.stack)throw Error('Ungültiger Betrag')
    if((move.kind==='raise'||move.kind==='bet')&&target<=before)throw Error('Der Einsatz muss erhöht werden')
    if(target>before){
      if(p.actedAtBet>0&&before-p.actedAtBet<g.minRaise)throw Error('Ein kurzer All-in eröffnet das Erhöhen nicht erneut')
      const minimum=before<g.bb?g.bb:before+g.minRaise
      if(target<minimum&&target!==p.roundBet+p.stack)throw Error(`Mindesterhöhung ist ${minimum}`)
      if(target>=minimum)g.minRaise=before<g.bb?target:target-before
      g.highestBet=target
    }
    commit(p,target-p.roundBet)
  }
  p.actedAtBet=g.highestBet
  const live=seated(g).filter(x=>!x.folded)
  if(live.length===1){g.turn=null;g.phase='showdown';assertChips(g);return g}
  assignTurn(g,p.seat);assertChips(g);return g
}
export function reveal(g:Game){
  const map:Partial<Record<Phase,Phase>>={'waiting-flop':'flop','waiting-turn':'turn','waiting-river':'river'}
  const phase=map[g.phase];if(!phase||g.paid)throw Error('Keine Karten aufzudecken')
  g.phase=phase;assignTurn(g,g.dealer);assertChips(g);return g
}
export function buildPots(g:Game):Pot[]{
  const levels=[...new Set(seated(g).map(p=>p.handBet).filter(Boolean))].sort((a,b)=>a-b);let prev=0
  return levels.map(level=>{const contributors=seated(g).filter(p=>p.handBet>=level);const pot={amount:(level-prev)*contributors.length,eligible:contributors.filter(p=>!p.folded).map(p=>p.uid)};prev=level;return pot}).filter(p=>p.amount>0)
}
export function payout(g:Game,winners:string[][]){
  if(g.paid||g.phase!=='showdown')throw Error('Die Hand kann nicht ausgezahlt werden')
  const pots=buildPots(g)
  if(!Array.isArray(winners)||winners.length!==pots.length)throw Error('Für jeden Pot Gewinner wählen')
  pots.forEach((pot,i)=>{const ws=winners[i];if(!Array.isArray(ws)||!ws.length||new Set(ws).size!==ws.length||ws.some(id=>!pot.eligible.includes(id)))throw Error('Nicht berechtigter Gewinner')})
  const additions:Record<string,number>={}
  pots.forEach((pot,i)=>{
    const ws=winners[i],share=Math.floor(pot.amount/ws.length),rest=pot.amount%ws.length
    ws.forEach(id=>additions[id]=(additions[id]||0)+share)
    const order=seated(g).filter(p=>ws.includes(p.uid)&&p.seat>g.dealer).concat(seated(g).filter(p=>ws.includes(p.uid)&&p.seat<=g.dealer))
    for(let n=0;n<rest;n++)additions[order[n].uid]++
  })
  for(const p of seated(g)){p.stack+=additions[p.uid]||0;p.handBet=0;p.roundBet=0}
  g.pots=pots;g.paid=true;g.phase='settled';g.turn=null;g.highestBet=0;assertChips(g);return g
}
export function nextHand(g:Game){
  if(g.phase!=='settled'||!g.paid)throw Error('Zuerst die aktuelle Hand abrechnen')
  if(seated(g).filter(p=>p.stack>0&&!p.sittingOut).length<2)throw Error('Mindestens zwei Spieler müssen aktiv sein')
  g.dealer=next(g,g.dealer,p=>p.stack>0&&!p.sittingOut)!.seat;g.handId++;g.phase='waiting-deal';g.paid=false;g.turn=null;g.highestBet=0;g.minRaise=g.bb;g.pots=[]
  for(const p of seated(g)){p.folded=p.stack===0||!!p.sittingOut;p.allIn=false;p.roundBet=0;p.handBet=0;p.actedAtBet=-1}
  assertChips(g);return g
}

export function addLatePlayer(g:Game, player:Pick<Player,'uid'|'name'|'seat'>, stack:number){
  if(!['waiting-deal','settled'].includes(g.phase)||g.players[player.uid]||!Number.isSafeInteger(stack)||stack<=0||Object.values(g.players).some(p=>p.seat===player.seat))throw Error('Später Einstieg nur zwischen Händen möglich')
  if(!Number.isSafeInteger(g.totalChips+stack))throw Error('Chip-Grenze erreicht')
  g.players[player.uid]={...player,stack,folded:false,allIn:false,roundBet:0,handBet:0,actedAtBet:-1}
  g.totalChips+=stack;assertChips(g);return g
}
