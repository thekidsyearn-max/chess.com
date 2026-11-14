// Sound engine. "wood" plays the pre-rendered WAV files from /sounds; "digital" is a
// live Web Audio synthesizer; "silent" mutes everything.
import { settings } from './settings.js';

const NAMES = ['move-self', 'move-opponent', 'capture', 'castle', 'check', 'promote', 'game-start', 'game-end', 'tenseconds', 'premove', 'illegal', 'puzzle-solve'];
let ctx = null, master = null;
const buffers = new Map();
const loading = new Map();

function audio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  master.gain.value = Math.max(0, Math.min(1, settings.get('volume')));
  return ctx;
}

// browsers only allow audio after a gesture
const unlock = () => { audio(); window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); };
window.addEventListener('pointerdown', unlock);
window.addEventListener('keydown', unlock);

function load(name) {
  if (buffers.has(name)) return Promise.resolve(buffers.get(name));
  if (!loading.has(name)) {
    loading.set(name, fetch(`/sounds/${name}.wav`).then((r) => r.arrayBuffer()).then((ab) => audio().decodeAudioData(ab)).then((buf) => { buffers.set(name, buf); return buf; }).catch(() => null));
  }
  return loading.get(name);
}

// ---- digital theme: synthesized on the fly -------------------------------------------
const tone = (ac, freq, at, dur, type = 'sine', gain = 0.25, slide = 0) => {
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, at);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), at + dur);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g); g.connect(master);
  o.start(at); o.stop(at + dur + 0.02);
};
const DIGITAL = {
  'move-self': (ac, t) => tone(ac, 520, t, 0.07, 'triangle', 0.3, -160),
  'move-opponent': (ac, t) => tone(ac, 400, t, 0.08, 'triangle', 0.26, -120),
  capture: (ac, t) => { tone(ac, 300, t, 0.1, 'square', 0.16, -180); tone(ac, 760, t, 0.05, 'triangle', 0.2, -300); },
  castle: (ac, t) => { tone(ac, 520, t, 0.06, 'triangle', 0.28, -120); tone(ac, 620, t + 0.09, 0.07, 'triangle', 0.28, -140); },
  check: (ac, t) => { tone(ac, 880, t, 0.09, 'sine', 0.26); tone(ac, 1175, t + 0.08, 0.14, 'sine', 0.22); },
  promote: (ac, t) => [523, 659, 784, 1047].forEach((f, i) => tone(ac, f, t + i * 0.06, 0.16, 'sine', 0.22)),
  'game-start': (ac, t) => { tone(ac, 392, t, 0.22, 'sine', 0.25); tone(ac, 523, t + 0.13, 0.3, 'sine', 0.25); },
  'game-end': (ac, t) => [523, 392, 330].forEach((f, i) => tone(ac, f, t + i * 0.16, 0.34, 'sine', 0.24)),
  tenseconds: (ac, t) => [0, 0.15, 0.3].forEach((d) => tone(ac, 1500, t + d, 0.05, 'square', 0.1)),
  premove: (ac, t) => tone(ac, 900, t, 0.04, 'sine', 0.12),
  illegal: (ac, t) => { tone(ac, 120, t, 0.1, 'sawtooth', 0.14); tone(ac, 100, t + 0.12, 0.12, 'sawtooth', 0.14); },
  'puzzle-solve': (ac, t) => [523, 659, 784, 1047, 1319].forEach((f, i) => tone(ac, f, t + i * 0.07, 0.24, 'sine', 0.2)),
};

export function play(name) {
  const theme = settings.get('soundTheme');
  if (theme === 'silent' || settings.get('volume') <= 0 || !NAMES.includes(name)) return;
  const ac = audio();
  if (!ac || ac.state !== 'running') return;
  if (theme === 'digital') { DIGITAL[name](ac, ac.currentTime + 0.005); return; }
  load(name).then((buf) => {
    if (!buf) return;
    const src = ac.createBufferSource();
    src.buffer = buf;
    src.connect(master);
    src.start();
  });
}

export function preload() { if (settings.get('soundTheme') === 'wood' && audio()) for (const n of NAMES.slice(0, 6)) load(n); }

// Picks the right effect for a move record ({ san, captured, flag, promo }) made by `mine`.
export function playMove(rec, mine = true) {
  const san = rec.san || '';
  if (san.includes('#')) play('game-end');
  else if (san.includes('+')) play('check');
  else if (rec.promo || san.includes('=')) play('promote');
  else if (san.startsWith('O-O')) play('castle');
  else if (rec.captured || san.includes('x')) play('capture');
  else play(mine ? 'move-self' : 'move-opponent');
}
