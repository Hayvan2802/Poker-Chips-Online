import {soundEnabled} from './preferences'
let context: AudioContext|undefined
export function playCue(kind:'turn'|'win') {
  if (!soundEnabled.value || typeof window==='undefined') return
  try {
    const Constructor=window.AudioContext
    if (!Constructor) return
    context ??= new Constructor()
    if (context.state==='suspended') {void context.resume().catch(()=>{})}
    const oscillator=context.createOscillator(), gain=context.createGain(), at=context.currentTime
    oscillator.type='sine';oscillator.frequency.value=kind==='turn'?660:880
    gain.gain.setValueAtTime(0.0001,at)
    gain.gain.exponentialRampToValueAtTime(0.055,at+0.015)
    gain.gain.exponentialRampToValueAtTime(0.0001,at+0.18)
    oscillator.connect(gain);gain.connect(context.destination)
    oscillator.start(at);oscillator.stop(at+0.2)
  } catch { /* Audio is optional on Safari and in private mode. */ }
}
