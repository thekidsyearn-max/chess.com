#!/usr/bin/env node
// Deterministic PCM synthesizer: renders every sound effect to 16-bit mono WAV files
// in public/sounds/. No samples are downloaded — each sound is built from filtered
// noise bursts (wooden knocks) and decaying partials (chimes), with a seeded PRNG so
// the output is byte-identical on every run.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'sounds');
const SR = 44100;

function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const buffer = (seconds) => new Float32Array(Math.ceil(seconds * SR));

function mix(dst, src, at = 0, gain = 1) {
  const off = Math.round(at * SR);
  for (let i = 0; i < src.length && off + i < dst.length; i++) dst[off + i] += src[i] * gain;
  return dst;
}

// RBJ biquad band-pass / low-pass / high-pass
function biquad(x, type, freq, q) {
  const w = (2 * Math.PI * freq) / SR, cos = Math.cos(w), alpha = Math.sin(w) / (2 * q);
  let b0, b1, b2;
  if (type === 'band') { b0 = alpha; b1 = 0; b2 = -alpha; }
  else if (type === 'low') { b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = (1 - cos) / 2; }
  else { b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = (1 + cos) / 2; }
  const a0 = 1 + alpha, a1 = -2 * cos, a2 = 1 - alpha;
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = (b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}

// A struck piece of wood: a click of band-passed noise plus two damped body resonances.
function knock({ seed, pitch = 900, body = 190, dur = 0.14, bright = 1, thump = 0.9 }) {
  const rnd = prng(seed), n = Math.ceil(dur * SR);
  const noise = new Float32Array(n);
  for (let i = 0; i < n; i++) noise[i] = (rnd() * 2 - 1) * Math.exp(-i / (SR * 0.006));
  const click = biquad(noise, 'band', pitch, 2.2);
  const snap = biquad(noise, 'high', 2600, 0.8);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const res = Math.sin(2 * Math.PI * pitch * 0.62 * t) * Math.exp(-t / 0.018) * 0.5 + Math.sin(2 * Math.PI * body * t) * Math.exp(-t / 0.045) * thump;
    out[i] = click[i] * 5.5 + snap[i] * 0.55 * bright + res * 0.55;
  }
  return out;
}

// A bell-like note: fundamental plus inharmonic partials with independent decays.
function chime(freq, dur, { attack = 0.004, decay = 0.35, partials = [[1, 1], [2.0, 0.35], [3.01, 0.16], [4.2, 0.07]] } = {}) {
  const n = Math.ceil(dur * SR), out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let v = 0;
    for (const [mul, amp] of partials) v += Math.sin(2 * Math.PI * freq * mul * t) * amp * Math.exp(-t / (decay / Math.sqrt(mul)));
    out[i] = v * Math.min(1, t / attack);
  }
  return out;
}

function buzz(freq, dur) {
  const n = Math.ceil(dur * SR), out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let v = 0;
    for (let h = 1; h <= 9; h += 2) v += Math.sin(2 * Math.PI * freq * h * t) / h; // soft square
    out[i] = v * Math.min(1, t / 0.004) * Math.min(1, (dur - t) / 0.02);
  }
  return biquad(out, 'low', 1400, 0.7);
}

function finish(x, peak = 0.85) {
  // fade the last 6 ms to avoid clicks, then normalise
  const fade = Math.min(x.length, Math.round(0.006 * SR));
  for (let i = 0; i < fade; i++) x[x.length - 1 - i] *= i / fade;
  let max = 0;
  for (const v of x) max = Math.max(max, Math.abs(v));
  const g = max > 0 ? peak / max : 1;
  for (let i = 0; i < x.length; i++) x[i] = Math.tanh(x[i] * g * 1.05) / Math.tanh(1.05);
  return x;
}

function wav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * 2, 28);
  h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

const NOTE = { E4: 329.63, G4: 392.0, A4: 440.0, C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99, A5: 880.0, C6: 1046.5, E6: 1318.5 };

const SOUNDS = {
  'move-self': () => finish(mix(buffer(0.16), knock({ seed: 11, pitch: 980, body: 205 })), 0.8),
  'move-opponent': () => finish(mix(buffer(0.17), knock({ seed: 23, pitch: 760, body: 170, bright: 0.7 })), 0.72),
  capture: () => {
    const b = buffer(0.22);
    mix(b, knock({ seed: 31, pitch: 1250, body: 150, bright: 1.6, thump: 1.3, dur: 0.18 }));
    mix(b, knock({ seed: 37, pitch: 620, body: 120, bright: 0.5, thump: 1.2, dur: 0.16 }), 0.022, 0.8);
    return finish(b, 0.9);
  },
  castle: () => {
    const b = buffer(0.3);
    mix(b, knock({ seed: 41, pitch: 940, body: 200 }));
    mix(b, knock({ seed: 43, pitch: 820, body: 180 }), 0.105, 0.95);
    return finish(b, 0.82);
  },
  check: () => {
    const b = buffer(0.36);
    mix(b, knock({ seed: 53, pitch: 1050, body: 210 }));
    mix(b, chime(NOTE.A5, 0.3, { decay: 0.16, partials: [[1, 1], [2.76, 0.3], [5.4, 0.1]] }), 0.03, 0.42);
    return finish(b, 0.85);
  },
  promote: () => {
    const b = buffer(0.7);
    mix(b, knock({ seed: 61, pitch: 980, body: 200 }), 0, 0.7);
    [NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6].forEach((f, i) => mix(b, chime(f, 0.45, { decay: 0.22 }), 0.04 + i * 0.07, 0.36));
    return finish(b, 0.85);
  },
  'game-start': () => {
    const b = buffer(0.75);
    mix(b, chime(NOTE.G4, 0.5, { decay: 0.3 }), 0, 0.5);
    mix(b, chime(NOTE.C5, 0.6, { decay: 0.36 }), 0.14, 0.55);
    return finish(b, 0.8);
  },
  'game-end': () => {
    const b = buffer(1.15);
    mix(b, chime(NOTE.C5, 0.6, { decay: 0.32 }), 0, 0.5);
    mix(b, chime(NOTE.G4, 0.7, { decay: 0.38 }), 0.17, 0.5);
    mix(b, chime(NOTE.E4, 0.8, { decay: 0.5 }), 0.34, 0.55);
    return finish(b, 0.8);
  },
  tenseconds: () => {
    const b = buffer(0.55);
    for (let i = 0; i < 3; i++) mix(b, knock({ seed: 71 + i, pitch: 1900, body: 520, bright: 1.2, thump: 0.5, dur: 0.09 }), i * 0.16, 1 - i * 0.12);
    return finish(b, 0.78);
  },
  premove: () => finish(mix(buffer(0.09), knock({ seed: 83, pitch: 1500, body: 380, bright: 0.9, thump: 0.4, dur: 0.07 })), 0.5),
  illegal: () => {
    const b = buffer(0.3);
    mix(b, buzz(116, 0.1), 0, 0.9);
    mix(b, buzz(98, 0.13), 0.13, 0.9);
    return finish(b, 0.34);
  },
  'puzzle-solve': () => {
    const b = buffer(0.95);
    [NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6, NOTE.E6].forEach((f, i) => mix(b, chime(f, 0.6, { decay: 0.3, partials: [[1, 1], [2, 0.45], [3, 0.2], [4.1, 0.1]] }), i * 0.075, 0.34));
    return finish(b, 0.82);
  },
};

mkdirSync(OUT, { recursive: true });
let bytes = 0;
for (const [name, render] of Object.entries(SOUNDS)) {
  const file = wav(render());
  writeFileSync(path.join(OUT, `${name}.wav`), file);
  bytes += file.length;
}
console.log(`wrote ${Object.keys(SOUNDS).length} WAV files (${(bytes / 1024).toFixed(0)} kB) to public/sounds/`);
