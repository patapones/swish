// Cherche le cercle dans une image (ou une vidéo, à l'instant --at) autour d'un toucher approximatif,
// avec le même code que l'app (src/detect/rim.js).
// Usage : node analysis/find-rim.mjs fichier 390,385 [--at 15] [--ffmpeg /chemin/ffmpeg]
import { execFileSync } from 'node:child_process';
import { findRim } from '../src/detect/rim.js';

const [file, tap] = process.argv.slice(2);
const opt = (name, def) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : def);
const ff = opt('--ffmpeg', 'ffmpeg');
const [tx, ty] = tap.split(',').map(Number);
const [VW, VH] = [1920, 1080];
const R = Math.round(0.11 * VW);
const x0 = Math.max(0, tx - R), y0 = Math.max(0, ty - R);
const W = Math.min(VW, tx + R) - x0, H = Math.min(VH, ty + R) - y0;
const buf = execFileSync(ff, ['-loglevel', 'error', '-ss', opt('--at', '0'), '-i', file, '-frames:v', '1',
  '-vf', `crop=${W}:${H}:${x0}:${y0}`, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1e8 });
const r = findRim(new Uint8Array(buf), W, H, { x: tx - x0, y: ty - y0 });
console.log(r ? `${Math.round(r.x + x0)},${Math.round(r.y + y0)},${r.w}` : 'rien');
