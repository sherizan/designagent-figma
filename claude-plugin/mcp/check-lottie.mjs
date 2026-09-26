// Self-check for src/lottie.ts: `node check-lottie.mjs` — exits non-zero on failure.
import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { outputFiles } = await build({ entryPoints: ['src/lottie.ts'], bundle: true, format: 'esm', write: false, platform: 'node' });
const mod = await import('data:text/javascript;base64,' + Buffer.from(outputFiles[0].text).toString('base64'));

const fixture = JSON.parse(readFileSync(process.argv[2] ?? 'fixtures/logo.json', 'utf8'));

const last = mod.lottieFrameToSvg(fixture, 'last');
assert.equal(last.skipped.length, 0, `unexpected skips: ${last.skipped}`);
assert.match(last.svg, /translate\(60 60\) rotate\(45\)/, 'animated position/rotation at last frame');
assert.match(last.svg, /scale\(1 1\)/, 'circle scale reached 100%');
assert.match(last.svg, /<rect x="-30" y="-30" width="60" height="60" rx="8"\/>/, 'rect centred on its anchor');
assert.match(last.svg, /<ellipse cx="0" cy="0" rx="35" ry="35"\/>/, 'ellipse');
assert.match(last.svg, /<path d="M 0 0 C 0 0 120 0 120 0 C 120 0 60 60 60 60 C 60 60 0 0 0 0 Z"\/>/, 'closed path');
assert.match(last.svg, /fill="#d94d33"/, 'fill colour');
assert.match(last.svg, /stroke="#000000" stroke-width="4"/, 'stroke');
assert.match(last.svg, /<rect width="40" height="40" fill="#ffcc00"\/>/, 'solid layer');
assert.ok(last.svg.indexOf('Solid') === -1 && last.svg.indexOf('#ffcc00') < last.svg.indexOf('#d94d33'), 'last Lottie layer draws first (bottom)');

const mid = mod.lottieFrameToSvg(fixture, 29.5);
assert.match(mid.svg, /translate\(40 40\) rotate\(22\.5\)/, 'linear interpolation at the midpoint');
const first = mod.lottieFrameToSvg(fixture, 0);
assert.match(first.svg, /scale\(0\.1 0\.1\)/, 'first keyframe');
console.log('lottie check ok');
