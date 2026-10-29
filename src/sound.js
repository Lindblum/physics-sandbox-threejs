// Collision and friction sounds, synthesized (Web Audio) from each material's
// sound columns in materials.csv, placed where they happen.
//
// An impact rings both objects: each a few decaying sine partials (its modes,
// as ratios of impact_hz, each fading over impact_ring_s or quicker the
// higher it is) and a short burst of noise (impact_noise of it), the lot
// low-passed at impact_bright_hz. Bigger objects ring lower (impact_hz is a
// 10 cm one's); harder hits are louder and brighter, loudness going with the
// impact's energy (speed × √mass, eased so heavy hits don't clip).
//
// Sliding hisses: noise through a band-pass around both materials' scrape_hz,
// louder the faster it slides and the harder it presses; a rolling ball rumbles.

const MAX_IMPACTS = 32; // voices ringing at once (more are dropped)
const MAX_SCRAPES = 12;
const SCRAPE_HOLD = 0.12; // s a slide sound lasts without news of it
const REF_SIZE = 0.1; // m: the size impact_hz is given for

let ctx = null;
let master = null;
let noise = null;
let volume = 1; // Options → Accessibility → Volume: 0 (off) to 1
let impacts = 0;
const scrapes = new Map(); // key -> voice

/**
 * Starts the sound (browsers wait for a touch, a click or a key), or wakes it
 * if it was suspended (a headset's browser may suspend it as an XR session
 * starts: see wakeSoundInXR).
 */
function wake() {
  if (!ctx) {
    const AudioContext = window.AudioContext ?? window.webkitAudioContext;
    if (!AudioContext) return;
    ctx = new AudioContext({ latencyHint: 'interactive' });
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -12;
    compressor.ratio.value = 6;
    compressor.connect(ctx.destination);
    master = ctx.createGain();
    master.gain.value = volume;
    master.connect(compressor);
    // two seconds of white noise, played from random places
    noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  if (ctx.state !== 'running') ctx.resume().catch(() => {});
}

/** The sound starts when the page is first touched; later touches wake it if it was suspended. */
export function initSound() {
  for (const type of ['pointerdown', 'keydown', 'touchend']) window.addEventListener(type, wake, { capture: true });
}

/**
 * In an XR session the page gets no touches or clicks: the controllers'
 * presses (select, squeeze) wake the sound instead, and it's woken as the
 * session starts. Returns a function that stops listening.
 */
export function wakeSoundInXR(session) {
  const types = ['selectstart', 'squeezestart', 'select'];
  for (const type of types) session.addEventListener(type, wake);
  wake();
  return () => {
    for (const type of types) session.removeEventListener(type, wake);
  };
}

const running = () => (ctx?.state === 'running' && volume > 0 ? ctx : null);

/** Options → Accessibility → Volume: 0 (off) to 1. */
export function setVolume(value) {
  volume = Math.max(0, Math.min(1, value || 0));
  if (master) master.gain.setTargetAtTime(volume, ctx.currentTime, 0.03);
}

/** Where the listener is: the viewer's camera (its world matrix). */
export function setListener(matrix) {
  if (!ctx) return;
  const e = matrix.elements;
  const l = ctx.listener;
  const t = ctx.currentTime;
  if (l.positionX) {
    l.positionX.setValueAtTime(e[12], t);
    l.positionY.setValueAtTime(e[13], t);
    l.positionZ.setValueAtTime(e[14], t);
    l.forwardX.setValueAtTime(-e[8], t);
    l.forwardY.setValueAtTime(-e[9], t);
    l.forwardZ.setValueAtTime(-e[10], t);
    l.upX.setValueAtTime(e[4], t);
    l.upY.setValueAtTime(e[5], t);
    l.upZ.setValueAtTime(e[6], t);
  } else {
    l.setPosition(e[12], e[13], e[14]);
    l.setOrientation(-e[8], -e[9], -e[10], e[4], e[5], e[6]);
  }
}

function panner(at) {
  const p = ctx.createPanner();
  p.panningModel = 'equalpower';
  p.distanceModel = 'inverse';
  p.refDistance = 0.6;
  p.rolloffFactor = 1;
  place(p, at);
  p.connect(master);
  return p;
}

function place(p, at) {
  if (p.positionX) {
    p.positionX.setTargetAtTime(at.x, ctx.currentTime, 0.02);
    p.positionY.setTargetAtTime(at.y, ctx.currentTime, 0.02);
    p.positionZ.setTargetAtTime(at.z, ctx.currentTime, 0.02);
  } else p.setPosition(at.x, at.y, at.z);
}

/**
 * Something of `material` (its `sound`, see materials.js), `size` m across
 * (the cube root of its volume), struck at `speed` m/s with the force of
 * `mass` kg behind it (the pair's reduced mass), at `at` (world).
 */
export function impact(material, size, speed, mass, at) {
  const c = running();
  const s = material.sound;
  if (!c || impacts >= MAX_IMPACTS || (!s.hz && !s.noise)) return;
  const strength = speed * Math.sqrt(Math.min(mass, 50) / 0.1) * 0.4 * s.gain;
  const amp = 0.55 * (1 - Math.exp(-strength));
  if (amp < 0.004) return;
  const t = c.currentTime + 0.003;
  const out = panner(at);
  const sizeScale = Math.min(4, Math.max(0.05, REF_SIZE / size));
  const f0 = s.hz * sizeScale * (1 + (Math.random() - 0.5) * 0.06);
  // a harder hit is a sharper one: more of the high partials
  const cutoff = s.bright * Math.min(2.5, Math.sqrt(0.2 + speed));
  let end = 0.05;
  if (s.hz > 0) {
    s.modes.forEach((ratio, k) => {
      const f = f0 * ratio;
      if (f < 20 || f > 16000) return;
      const weight = ((1 - s.noise * 0.6) / (1 + k * 0.8) / (1 + (f / cutoff) ** 2)) * (0.7 + 0.6 * Math.random());
      const ring = s.ring / (1 + 0.5 * (ratio - 1)); // (higher partials die sooner)
      const osc = c.createOscillator();
      osc.frequency.value = f;
      const g = c.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(amp * weight, t + 0.0015);
      g.gain.setTargetAtTime(0, t + 0.0015, ring / 6.9); // (60 dB down by `ring`)
      osc.connect(g).connect(out);
      osc.start(t);
      osc.stop(t + ring + 0.05);
      end = Math.max(end, ring + 0.05);
    });
  }
  if (s.noise > 0) {
    const burst = c.createBufferSource();
    burst.buffer = noise;
    const lowpass = c.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = Math.min(18000, cutoff);
    const highpass = c.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = Math.max(40, f0 * 0.5);
    const g = c.createGain();
    const length = 0.01 + 0.06 * s.noise;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(amp * s.noise * 1.3, t + 0.001);
    g.gain.setTargetAtTime(0, t + 0.001, length / 5);
    burst.connect(lowpass).connect(highpass).connect(g).connect(out);
    burst.start(t, Math.random() * 1.5);
    burst.stop(t + length + 0.02);
    end = Math.max(end, length + 0.02);
  }
  impacts++;
  setTimeout(() => {
    impacts--;
    out.disconnect();
  }, (end + 0.1) * 1000);
}

/**
 * Two things touching, `key` naming the pair (the same each step): sliding
 * past each other at `slide` m/s, a ball rolling at `roll` m/s, pressed
 * together with `force` N, at `at`. Silent unless told again within SCRAPE_HOLD.
 */
export function scrape(key, a, b, slide, roll, force, at) {
  const c = running();
  if (!c) return;
  let v = scrapes.get(key);
  const press = Math.min(1, Math.max(0.08, Math.sqrt(force) / 3));
  const slideAmp = slide < 0.03 ? 0 : Math.sqrt(a.sound.scrapeGain * b.sound.scrapeGain) * Math.min(1, slide / 0.8) * press * 0.3;
  const rollAmp = roll < 0.05 ? 0 : Math.min(1, roll / 1.5) * press * 0.25;
  if (!v) {
    if ((!slideAmp && !rollAmp) || scrapes.size >= MAX_SCRAPES) return;
    v = { out: panner(at), source: c.createBufferSource(), band: c.createBiquadFilter(), slide: c.createGain(), rumble: c.createBiquadFilter(), roll: c.createGain() };
    v.source.buffer = noise;
    v.source.loop = true;
    v.band.type = 'bandpass';
    v.rumble.type = 'lowpass';
    v.rumble.frequency.value = 160;
    v.slide.gain.value = v.roll.gain.value = 0;
    v.source.connect(v.band).connect(v.slide).connect(v.out);
    v.source.connect(v.rumble).connect(v.roll).connect(v.out);
    v.source.start(c.currentTime, Math.random() * 1.5);
    scrapes.set(key, v);
  }
  const now = c.currentTime;
  const hz = Math.sqrt(a.sound.scrapeHz * b.sound.scrapeHz) * (0.6 + 0.4 * Math.min(slide, 2));
  v.band.frequency.setTargetAtTime(Math.min(12000, hz), now, 0.04);
  v.band.Q.value = (a.sound.scrapeQ + b.sound.scrapeQ) / 2;
  v.slide.gain.setTargetAtTime(slideAmp, now, 0.03);
  v.roll.gain.setTargetAtTime(rollAmp, now, 0.05);
  place(v.out, at);
  v.seen = now;
}

/** Each frame: slide sounds no longer told of fade out. */
export function updateSounds() {
  if (!ctx) return;
  const now = ctx.currentTime;
  for (const [key, v] of scrapes) {
    if (now - v.seen < SCRAPE_HOLD && volume > 0) continue;
    scrapes.delete(key);
    v.slide.gain.setTargetAtTime(0, now, 0.03);
    v.roll.gain.setTargetAtTime(0, now, 0.03);
    v.source.stop(now + 0.25);
    setTimeout(() => v.out.disconnect(), 400);
  }
}
