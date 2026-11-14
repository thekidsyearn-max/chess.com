#!/usr/bin/env node
// Generates Rookery's four original SVG piece sets (12 pieces each) into public/pieces/.
//   modern   – bold flat shapes with soft shading
//   classic  – outlined Staunton-style tournament pieces
//   wood     – the Staunton shapes carved in maple and walnut
//   minimal  – geometric glyphs
// All artwork is defined below as vector paths in a 100×100 box; nothing is downloaded.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'pieces');
const BASE_A = 'M25,77 H75 a4,4 0 0 1 4,4 v4 a4,4 0 0 1 -4,4 H25 a4,4 0 0 1 -4,-4 v-4 a4,4 0 0 1 4,-4 Z';
const BASE_B = 'M27,75 H73 a6,6 0 0 1 6,6 v2 a6,6 0 0 1 -6,6 H27 a6,6 0 0 1 -6,-6 v-2 a6,6 0 0 1 6,-6 Z';

// ---- Staunton family (classic + wood). body = filled silhouette parts, detail = engraved lines.
const STAUNTON = {
  P: {
    body: ['M50,15 a12.5,12.5 0 1 1 -0.01,0 Z', 'M41,40 C45,45 44,50 40,55 C34,62 30,69 29,77 H71 C70,69 66,62 60,55 C56,50 55,45 59,40 Z', BASE_A],
    detail: ['M38,41 Q50,46 62,41'],
  },
  R: {
    body: ['M27,17 H37 V24 H45 V17 H55 V24 H63 V17 H73 V33 L66,39 V63 L73,77 H27 L34,63 V39 L27,33 Z', BASE_A],
    detail: ['M34,39 H66', 'M34,63 H66', 'M27,31 H73'],
  },
  B: {
    body: ['M50,7 a4.6,4.6 0 1 1 -0.01,0 Z', 'M50,17 C39,27 33,37 35,47 C37,54 43,57 50,57 C57,57 63,54 65,47 C67,37 61,27 50,17 Z', 'M40,58 C41,66 35,70 30,77 H70 C65,70 59,66 60,58 Z', BASE_A],
    detail: ['M54,27 L46,39', 'M37,58 Q50,62 63,58'],
  },
  N: {
    body: ['M19,45 C21,37 27,28 35,22 L36,10 L45,19 C59,20 70,32 73,48 C75,58 74,68 72,77 H30 C31,68 38,61 44,55 C46,52 46,49 44,46 C39,50 33,54 27,56 C22,57 19,53 19,49 Z', BASE_A],
    detail: ['M46,20 C52,26 55,33 55,41', 'M54,24 C61,30 65,39 65,49'],
    eye: [34, 32, 2.4], nostril: [23.5, 48, 1.3],
  },
  Q: {
    body: ['M23,31 L31,59 H69 L77,31 L65,47 L62,25 L54,45 L50,23 L46,45 L38,25 L35,47 Z', 'M31,59 C32,66 29,71 27,77 H73 C71,71 68,66 69,59 Z', BASE_A],
    balls: [[23, 27, 4.4], [38, 21, 4.4], [50, 18.5, 4.6], [62, 21, 4.4], [77, 27, 4.4]],
    detail: ['M32,60 Q50,65 68,60'],
  },
  K: {
    body: ['M46.5,5 h7 v7 h7 v6.5 h-7 v9 h-7 v-9 h-7 V12 h7 Z', 'M50,28 C43,28 38,33 40,41 C31,33 20,38 23,50 C25,57 30,61 32,65 H68 C70,61 75,57 77,50 C80,38 69,33 60,41 C62,33 57,28 50,28 Z', 'M32,65 C33,69 30,73 28,77 H72 C70,73 67,69 68,65 Z', BASE_A],
    detail: ['M50,41 V64', 'M33,66 Q50,70 67,66'],
  },
};

// ---- Modern family: chunkier, simplified silhouettes.
const MODERN = {
  P: { body: ['M50,16 a14,14 0 1 1 -0.01,0 Z', 'M34,77 C35,62 42,57 44,46 H56 C58,57 65,62 66,77 Z', BASE_B] },
  R: { body: ['M25,15 H38 V23 H44 V15 H56 V23 H62 V15 H75 V36 Q75,39 72,39 H67 V63 H70 Q73,63 73,66 V77 H27 V66 Q27,63 30,63 H33 V39 H28 Q25,39 25,36 Z', BASE_B] },
  B: { body: ['M50,9 C63,22 69,34 67,46 C66,55 59,61 50,61 C41,61 34,55 33,46 C31,34 37,22 50,9 Z', 'M40,61 H60 L67,77 H33 Z', BASE_B], slit: 'M56,25 L47,39' },
  N: { body: ['M29,77 C29,62 36,55 45,49 L36,53 C28,56 21,51 21,44 L31,27 L32,12 L44,22 C63,22 75,38 75,58 V77 Z', BASE_B], eye: [36, 33, 2.8] },
  Q: { body: ['M21,27 L33,47 L37,21 L46,45 L50,17 L54,45 L63,21 L67,47 L79,27 L71,66 H29 Z', 'M30,66 H70 L75,77 H25 Z', BASE_B], balls: [[21, 24, 5], [37, 18, 5], [50, 14, 5.2], [63, 18, 5], [79, 24, 5]] },
  K: { body: ['M45,4 H55 V11 H62 V21 H55 V29 H45 V21 H38 V11 H45 Z', 'M25,41 C25,32 36,30 50,30 C64,30 75,32 75,41 L69,66 H31 Z', 'M31,66 H69 L75,77 H25 Z', BASE_B], band: 'M33,57 H67' },
};

// ---- Minimal family: flat geometric glyphs.
const MINIMAL = {
  P: { body: ['M50,22 a13,13 0 1 1 -0.01,0 Z', 'M35,85 L44,52 H56 L65,85 Z'] },
  R: { body: ['M29,21 H40 V30 H45 V21 H55 V30 H60 V21 H71 V45 H64 V72 H72 V85 H28 V72 H36 V45 H29 Z'] },
  B: { body: ['M50,13 C65,30 67,45 60,56 H40 C33,45 35,30 50,13 Z', 'M40,62 H60 L69,85 H31 Z'], slit: 'M56,28 L48,41' },
  N: { body: ['M29,85 V60 L21,50 L40,17 L48,26 C67,28 73,50 73,85 Z'], eye: [41, 36, 3] },
  Q: { body: ['M25,30 L38,48 L50,24 L62,48 L75,30 L67,85 H33 Z'], balls: [[25, 24, 5.5], [50, 17, 5.5], [75, 24, 5.5]] },
  K: { body: ['M44,11 H56 V20 H65 V31 H56 V39 H71 L65,85 H35 L29,39 H44 V31 H35 V20 H44 Z'] },
};

const svg = (inner, defs = '') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">${defs ? `<defs>${defs}</defs>` : ''}${inner}</svg>\n`;
const circle = ([x, y, r], attrs) => `<circle cx="${x}" cy="${y}" r="${r}" ${attrs}/>`;

function classic(shape, white) {
  const fill = white ? '#ffffff' : '#2b2b2b', stroke = white ? '#111111' : '#000000', line = white ? '#111111' : '#ececec';
  const a = `fill="${fill}" stroke="${stroke}" stroke-width="2.8" stroke-linejoin="round" stroke-linecap="round"`;
  let s = shape.body.map((d) => `<path d="${d}" ${a}/>`).join('');
  s += (shape.balls || []).map((b) => circle(b, a)).join('');
  s += (shape.detail || []).map((d) => `<path d="${d}" fill="none" stroke="${line}" stroke-width="2.2" stroke-linecap="round"/>`).join('');
  if (shape.eye) s += circle(shape.eye, `fill="${line}"`);
  if (shape.nostril) s += circle(shape.nostril, `fill="${line}"`);
  return svg(s);
}

function wood(shape, white, id) {
  const [c0, c1, c2] = white ? ['#f9e7c4', '#e3bd82', '#c4975a'] : ['#9a6a42', '#6b4124', '#432511'];
  const stroke = white ? '#7c5529' : '#1f0f06', line = white ? '#8a5f30' : '#d9b48a';
  const defs = `<linearGradient id="g${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c0}"/><stop offset="0.55" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient>`
    + `<clipPath id="c${id}">${shape.body.map((d) => `<path d="${d}"/>`).join('')}${(shape.balls || []).map((b) => circle(b, '')).join('')}</clipPath>`;
  const a = `fill="url(#g${id})" stroke="${stroke}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"`;
  let s = shape.body.map((d) => `<path d="${d}" ${a}/>`).join('');
  s += (shape.balls || []).map((b) => circle(b, a)).join('');
  // wood grain and a soft highlight, clipped to the silhouette
  const grain = white ? 'rgba(120,80,35,0.22)' : 'rgba(20,8,2,0.35)';
  s += `<g clip-path="url(#c${id})" fill="none" stroke="${grain}" stroke-width="1.1">`
    + '<path d="M10,30 C35,24 60,38 95,28"/><path d="M5,46 C30,40 62,54 98,44"/><path d="M5,60 C34,54 60,68 98,58"/><path d="M5,72 C30,68 66,80 98,70"/>'
    + `</g><g clip-path="url(#c${id})"><ellipse cx="38" cy="34" rx="9" ry="20" fill="rgba(255,255,255,${white ? 0.28 : 0.12})" transform="rotate(-18 38 34)"/></g>`;
  s += (shape.detail || []).map((d) => `<path d="${d}" fill="none" stroke="${line}" stroke-width="2" stroke-linecap="round"/>`).join('');
  if (shape.eye) s += circle(shape.eye, `fill="${white ? '#5c3b17' : '#e6c9a3'}"`);
  if (shape.nostril) s += circle(shape.nostril, `fill="${white ? '#5c3b17' : '#e6c9a3'}"`);
  return svg(s, defs);
}

function modern(shape, white, id) {
  const [c0, c1] = white ? ['#ffffff', '#d6dae0'] : ['#5d6470', '#2c3038'];
  const stroke = white ? '#3a3f48' : '#14161a', accent = white ? '#3a3f48' : '#e8ebf0';
  const defs = `<linearGradient id="g${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c0}"/><stop offset="1" stop-color="${c1}"/></linearGradient>`
    + `<clipPath id="c${id}">${shape.body.map((d) => `<path d="${d}"/>`).join('')}</clipPath>`;
  const a = `fill="url(#g${id})" stroke="${stroke}" stroke-width="3.2" stroke-linejoin="round"`;
  let s = shape.body.map((d) => `<path d="${d}" ${a}/>`).join('');
  s += `<g clip-path="url(#c${id})"><rect x="50" y="0" width="50" height="100" fill="rgba(0,0,0,${white ? 0.07 : 0.16})"/></g>`;
  s += (shape.balls || []).map((b) => circle(b, a)).join('');
  if (shape.slit) s += `<path d="${shape.slit}" fill="none" stroke="${accent}" stroke-width="4" stroke-linecap="round"/>`;
  if (shape.band) s += `<path d="${shape.band}" fill="none" stroke="${accent}" stroke-width="3.4" stroke-linecap="round"/>`;
  if (shape.eye) s += circle(shape.eye, `fill="${accent}"`);
  return svg(s, defs);
}

function minimal(shape, white) {
  const fill = white ? '#fbfbfb' : '#23262b', edge = white ? '#4b4f57' : '#c8ccd3', accent = white ? '#4b4f57' : '#dfe2e7';
  const a = `fill="${fill}" stroke="${edge}" stroke-width="1.6" stroke-linejoin="round"`;
  let s = shape.body.map((d) => `<path d="${d}" ${a}/>`).join('');
  s += (shape.balls || []).map((b) => circle(b, a)).join('');
  if (shape.slit) s += `<path d="${shape.slit}" fill="none" stroke="${accent}" stroke-width="4" stroke-linecap="round"/>`;
  if (shape.eye) s += circle(shape.eye, `fill="${accent}"`);
  return svg(s);
}

const SETS = {
  modern: (t, w) => modern(MODERN[t], w, 'm' + (w ? 'w' : 'b') + t),
  classic: (t, w) => classic(STAUNTON[t], w),
  wood: (t, w) => wood(STAUNTON[t], w, 'o' + (w ? 'w' : 'b') + t),
  minimal: (t, w) => minimal(MINIMAL[t], w),
};

let n = 0;
for (const [set, draw] of Object.entries(SETS)) {
  mkdirSync(path.join(OUT, set), { recursive: true });
  for (const color of ['w', 'b']) for (const type of ['K', 'Q', 'R', 'B', 'N', 'P']) {
    writeFileSync(path.join(OUT, set, `${color}${type}.svg`), draw(type, color === 'w'));
    n++;
  }
}
console.log(`wrote ${n} SVG pieces (${Object.keys(SETS).join(', ')}) to public/pieces/`);
