import type { Emitter, GameEvent } from '../game/events';
import { useUI } from '../ui/store';

/**
 * WebAudio synth (spec §19.1). No audio files: every sound is synthesized.
 * The AudioContext is created on the first keydown or pointerdown.
 */
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let volume = 0.8;
let muted = false;
let noiseBuf: AudioBuffer | null = null;
let lastBeat = 0;

function applyGain(): void {
  if (master) master.gain.value = muted ? 0 : 0.5 * volume;
}

function ensure(): void {
  if (ctx || typeof AudioContext === 'undefined') { if (ctx?.state === 'suspended') void ctx.resume(); return; }
  try {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.connect(ctx.destination);
    applyGain();
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    void ctx.resume();
  } catch { ctx = null; }
}

/** Short envelope: 5 ms attack, exponential release. */
function env(g: GainNode, t0: number, dur: number, peak: number): void {
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(peak, t0 + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + Math.max(0.02, dur));
}

interface ToneOpts { type?: OscillatorType; f0: number; f1?: number; f2?: number; dur: number; gain?: number; delay?: number; lowpass?: number; wobble?: number }

function tone(o: ToneOpts): void {
  if (!ctx || !master) return;
  const t0 = ctx.currentTime + (o.delay ?? 0);
  const osc = ctx.createOscillator();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(o.f0, t0);
  if (o.f2 !== undefined && o.f1 !== undefined) {
    osc.frequency.linearRampToValueAtTime(o.f1, t0 + o.dur * 0.5);
    osc.frequency.linearRampToValueAtTime(o.f2, t0 + o.dur);
  } else if (o.f1 !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f1), t0 + o.dur);
  const g = ctx.createGain();
  env(g, t0, o.dur, o.gain ?? 0.5);
  let node: AudioNode = osc;
  if (o.lowpass) {
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lowpass;
    node.connect(f); node = f;
  }
  if (o.wobble) {
    const lfo = ctx.createOscillator(), lg = ctx.createGain();
    lfo.frequency.value = o.wobble; lg.gain.value = o.f0 * 0.15;
    lfo.connect(lg); lg.connect(osc.frequency); lfo.start(t0); lfo.stop(t0 + o.dur + 0.05);
  }
  node.connect(g); g.connect(master);
  osc.start(t0); osc.stop(t0 + o.dur + 0.05);
}

interface NoiseOpts { dur: number; gain?: number; delay?: number; lowpass?: number; band?: [number, number]; am?: number }

function noise(o: NoiseOpts): void {
  if (!ctx || !master || !noiseBuf) return;
  const t0 = ctx.currentTime + (o.delay ?? 0);
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf; src.loop = true;
  const g = ctx.createGain();
  env(g, t0, o.dur, o.gain ?? 0.4);
  let node: AudioNode = src;
  if (o.lowpass) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lowpass; node.connect(f); node = f; }
  if (o.band) {
    const f = ctx.createBiquadFilter(); f.type = 'bandpass';
    f.frequency.setValueAtTime(o.band[0], t0); f.frequency.exponentialRampToValueAtTime(o.band[1], t0 + o.dur);
    f.Q.value = 2; node.connect(f); node = f;
  }
  if (o.am) {
    const am = ctx.createGain(); am.gain.value = 0.5;
    const lfo = ctx.createOscillator(), lg = ctx.createGain();
    lfo.frequency.value = o.am; lg.gain.value = 0.5; lfo.connect(lg); lg.connect(am.gain);
    lfo.start(t0); lfo.stop(t0 + o.dur + 0.05);
    node.connect(am); node = am;
  }
  node.connect(g); g.connect(master);
  src.start(t0); src.stop(t0 + o.dur + 0.05);
}

const C5 = 523.25, E5 = 659.25, G5 = 783.99, C6 = 1046.5;

const play = {
  jump: () => tone({ type: 'square', f0: 300, f1: 600, dur: 0.12, gain: 0.25 }),
  land: () => noise({ dur: 0.06, gain: 0.3, lowpass: 800 }),
  coin: () => { tone({ f0: 880, dur: 0.07, gain: 0.35 }); tone({ f0: 1320, dur: 0.07, gain: 0.35, delay: 0.07 }); },
  correct: () => [C5, E5, G5, C6].forEach((f, i) => tone({ type: 'triangle', f0: f, dur: 0.09, gain: 0.45, delay: i * 0.07 })),
  wrong: (short = false) => tone({ type: 'sawtooth', f0: 220, f1: 110, dur: short ? 0.22 : 0.35, gain: 0.35, lowpass: 1200 }),
  doorBurst: () => { noise({ dur: 0.2, gain: 0.45 }); tone({ f0: 90, dur: 0.25, gain: 0.7 }); },
  bounce: () => tone({ f0: 200, f1: 400, f2: 150, dur: 0.25, gain: 0.5 }),
  step: () => tone({ f0: 660, dur: 0.06, gain: 0.4 }),
  crack: () => noise({ dur: 0.4, gain: 0.5, am: 30 }),
  whoosh: () => noise({ dur: 0.5, gain: 0.45, band: [2000, 300] }),
  surge: () => tone({ f0: 90, dur: 0.6, gain: 0.7, wobble: 6 }),
  tick: () => tone({ f0: 660, dur: 0.1, gain: 0.4 }),
  go: () => tone({ f0: 990, dur: 0.25, gain: 0.45 }),
  pickup: () => tone({ type: 'triangle', f0: 520, f1: 780, dur: 0.1, gain: 0.45 }),
  placeOk: () => { tone({ f0: 523, dur: 0.08, gain: 0.4 }); tone({ f0: 784, dur: 0.1, gain: 0.4, delay: 0.08 }); },
  fanfare: () => {
    [C5, E5, G5, C6].forEach((f, i) => tone({ type: 'triangle', f0: f, dur: 0.12, gain: 0.45, delay: i * 0.09 }));
    [C5, E5, G5].forEach((f) => tone({ type: 'triangle', f0: f, dur: 0.85, gain: 0.3, delay: 0.38 }));
  },
  sadTrombone: () => {
    tone({ type: 'sawtooth', f0: 400, f1: 300, dur: 0.33, gain: 0.3, lowpass: 1500 });
    tone({ type: 'sawtooth', f0: 300, f1: 220, dur: 0.33, gain: 0.3, lowpass: 1500, delay: 0.33 });
    tone({ type: 'sawtooth', f0: 220, f1: 150, dur: 0.34, gain: 0.3, lowpass: 1500, delay: 0.66 });
  },
  heartbeat: () => { tone({ f0: 60, dur: 0.12, gain: 0.8 }); tone({ f0: 60, dur: 0.12, gain: 0.8, delay: 0.15 }); },
  click: () => tone({ f0: 520, dur: 0.04, gain: 0.3 }),
  denied: () => tone({ type: 'square', f0: 150, dur: 0.15, gain: 0.25 }),
};

function onEvent(e: GameEvent): void {
  if (!ctx) return;
  switch (e.type) {
    case 'jump': play.jump(); break;
    case 'land': if (e.impact > 4) play.land(); break;
    case 'coin': play.coin(); break;
    case 'answer': if (e.correct) play.correct(); else play.wrong(); break;
    case 'doorBurst': play.doorBurst(); break;
    case 'doorWrong': case 'launch': play.whoosh(); break;
    case 'bounce': play.bounce(); break;
    case 'stepCorrect': play.step(); break;
    case 'stepWrong': case 'tileShake': play.crack(); break;
    case 'fall': case 'detourEnter': play.whoosh(); break;
    case 'slimeSurge': play.surge(); break;
    case 'countdown': if (e.n > 0) play.tick(); else play.go(); break;
    case 'blockPickup': play.pickup(); break;
    case 'blockPlaced': if (e.correct) play.placeOk(); else play.wrong(true); break;
    case 'bridgeComplete': case 'win': play.fanfare(); break;
    case 'lose': play.sadTrombone(); break;
    case 'lifeline': if (e.ok) play.click(); else play.denied(); break;
    case 'uiClick': case 'detourExit': play.click(); break;
    case 'speedPad': play.whoosh(); break;
    default: break;
  }
}

export const sfx = {
  attach(events: Emitter<GameEvent>): void {
    events.on(onEvent);
    if (typeof window === 'undefined') return;
    const unlock = () => ensure();
    window.addEventListener('keydown', unlock);
    window.addEventListener('pointerdown', unlock);
  },
  applySettings(v: number, m: boolean): void { volume = v; muted = m; applyGain(); },
  toggleMute(): void {
    muted = !muted; applyGain();
    // keep the store in sync so the settings panel shows the change
    useUI.setState((s) => ({ settings: { ...s.settings, muted } }));
  },
  click(): void { if (ctx) play.click(); },
  /** Called at the HUD rate while slime is dangerous; thumps once per second. */
  heartbeat(): void {
    if (!ctx) return;
    const now = ctx.currentTime;
    if (now - lastBeat >= 1) { lastBeat = now; play.heartbeat(); }
  },
};
