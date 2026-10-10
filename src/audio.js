// Tiny synthesised sound set. No samples: everything is oscillators and filtered noise.

let ctx = null, master = null, noiseBuf = null, drone = null;
let muted = false;

function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.5;
  master.connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return ctx;
}

// Browsers only allow audio after a gesture; call this from the first click.
export function unlock() {
  const c = ensure();
  if (c && c.state === 'suspended') c.resume();
}

export function toggleMute() {
  muted = !muted;
  if (master) master.gain.value = muted ? 0 : 0.5;
  return muted;
}

function tone({ type = 'sine', f0, f1 = f0, dur = 0.15, gain = 0.2, delay = 0 }) {
  if (!ctx || ctx.state !== 'running') return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise({ dur = 0.15, gain = 0.3, f0 = 2000, f1 = f0, q = 1, type = 'lowpass', delay = 0 }) {
  if (!ctx || ctx.state !== 'running') return;
  const t = ctx.currentTime + delay;
  const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = noiseBuf;
  s.loop = true;
  f.type = type;
  f.Q.value = q;
  f.frequency.setValueAtTime(f0, t);
  f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  s.connect(f).connect(g).connect(master);
  s.start(t, Math.random());
  s.stop(t + dur + 0.02);
}

export const sfx = {
  shot() { noise({ dur: 0.09, gain: 0.35, f0: 5000, f1: 900 }); tone({ type: 'square', f0: 220, f1: 70, dur: 0.07, gain: 0.12 }); },
  heavy() { noise({ dur: 0.16, gain: 0.45, f0: 3000, f1: 300 }); tone({ type: 'sawtooth', f0: 140, f1: 45, dur: 0.14, gain: 0.2 }); },
  flame() { noise({ dur: 0.55, gain: 0.3, f0: 700, f1: 2400, q: 0.6, type: 'bandpass' }); },
  plasma() { tone({ type: 'sawtooth', f0: 1400, f1: 180, dur: 0.4, gain: 0.16 }); noise({ dur: 0.35, gain: 0.15, f0: 6000, f1: 1200, type: 'highpass' }); },
  launch() { tone({ type: 'sine', f0: 180, f1: 90, dur: 0.18, gain: 0.3 }); noise({ dur: 0.1, gain: 0.2, f0: 900 }); },
  boom() { noise({ dur: 0.7, gain: 0.7, f0: 1400, f1: 60 }); tone({ type: 'sine', f0: 110, f1: 30, dur: 0.6, gain: 0.5 }); },
  spit() { noise({ dur: 0.22, gain: 0.2, f0: 800, f1: 3000, q: 4, type: 'bandpass' }); },
  slash() { noise({ dur: 0.1, gain: 0.25, f0: 5000, f1: 1500, type: 'highpass' }); },
  hit() { noise({ dur: 0.08, gain: 0.25, f0: 1200, f1: 300 }); tone({ type: 'triangle', f0: 160, f1: 60, dur: 0.1, gain: 0.2 }); },
  clang() { tone({ type: 'square', f0: 1900, f1: 1500, dur: 0.12, gain: 0.08 }); tone({ type: 'triangle', f0: 2750, f1: 2500, dur: 0.2, gain: 0.06 }); },
  squelch() { noise({ dur: 0.28, gain: 0.3, f0: 1800, f1: 200, q: 3, type: 'bandpass' }); tone({ type: 'sawtooth', f0: 320, f1: 60, dur: 0.25, gain: 0.1 }); },
  down() { tone({ type: 'sawtooth', f0: 300, f1: 50, dur: 0.6, gain: 0.25 }); },
  step() { noise({ dur: 0.04, gain: 0.07, f0: 500, f1: 200 }); },
  skitter() { noise({ dur: 0.03, gain: 0.05, f0: 3500, q: 6, type: 'bandpass' }); },
  click() { tone({ type: 'square', f0: 880, dur: 0.035, gain: 0.05 }); },
  deny() { tone({ type: 'square', f0: 160, f1: 120, dur: 0.14, gain: 0.08 }); },
  good() { tone({ type: 'triangle', f0: 520, f1: 780, dur: 0.16, gain: 0.14 }); },
  door() { noise({ dur: 0.6, gain: 0.2, f0: 300, f1: 120 }); tone({ type: 'sawtooth', f0: 70, f1: 50, dur: 0.6, gain: 0.15 }); },
  jet() { noise({ dur: 0.5, gain: 0.3, f0: 1200, f1: 4000, q: 0.8, type: 'bandpass' }); },
  spawn() { tone({ type: 'sawtooth', f0: 60, f1: 220, dur: 0.35, gain: 0.15 }); noise({ dur: 0.3, gain: 0.15, f0: 400, f1: 1500, q: 2, type: 'bandpass' }); },
  alarm() { tone({ type: 'square', f0: 440, dur: 0.14, gain: 0.07 }); tone({ type: 'square', f0: 330, dur: 0.18, gain: 0.07, delay: 0.16 }); },
  turn() { tone({ type: 'triangle', f0: 660, dur: 0.1, gain: 0.1 }); tone({ type: 'triangle', f0: 990, dur: 0.16, gain: 0.1, delay: 0.1 }); },
  win() { [523, 659, 784, 1047].forEach((f, i) => tone({ type: 'triangle', f0: f, dur: 0.35, gain: 0.16, delay: i * 0.13 })); },
  lose() { [392, 330, 262, 196].forEach((f, i) => tone({ type: 'sawtooth', f0: f, dur: 0.45, gain: 0.1, delay: i * 0.2 })); },
};

// Low reactor hum under the tactical view.
export function ambience(on) {
  if (!ensure()) return;
  if (drone) { drone.gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.5); const d = drone; setTimeout(() => d.nodes.forEach(n => n.stop()), 700); drone = null; }
  if (!on) return;
  const gain = ctx.createGain(), filter = ctx.createBiquadFilter();
  filter.type = 'lowpass'; filter.frequency.value = 220;
  gain.gain.value = 0;
  gain.gain.linearRampToValueAtTime(0.16, ctx.currentTime + 2);
  filter.connect(gain).connect(master);
  const nodes = [55, 55.7, 82.4, 110.3].map(f => {
    const o = ctx.createOscillator();
    o.type = 'sawtooth'; o.frequency.value = f;
    o.connect(filter); o.start();
    return o;
  });
  const lfo = ctx.createOscillator(), depth = ctx.createGain();
  lfo.frequency.value = 0.08; depth.gain.value = 90;
  lfo.connect(depth).connect(filter.frequency); lfo.start();
  nodes.push(lfo);
  drone = { gain, nodes };
}
