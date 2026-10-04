// Vérifie le détecteur de l'app (src/detect/core.js) sur une vidéo du terrain et sa vérité terrain.
// Usage : node analysis/check-js.mjs videos/xxx.mp4 analysis/labels-xxx.json --ffmpeg /chemin/ffmpeg
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createDetector, roiFor, scaleFor } from '../src/detect/core.js';

const [video, labelsPath] = process.argv.slice(2);
const ffmpeg = process.argv.includes('--ffmpeg') ? process.argv[process.argv.indexOf('--ffmpeg') + 1] : 'ffmpeg';
// labelsPath « - » : pas de vérité terrain, on affiche seulement les tirs détectés (--rim obligatoire)
const labels = labelsPath === '-' ? { shots: [], rim_px: null } : JSON.parse(readFileSync(labelsPath, 'utf8'));
// --height 720 : simule une caméra qui filme en 720p au lieu de 1080p
const outH = process.argv.includes('--height') ? +process.argv[process.argv.indexOf('--height') + 1] : 1080;
const k = outH / 1080;
const outW = Math.round(1920 * k);
// --rim x,y,w : remplace le cercle de la vérité terrain (ex. celui trouvé automatiquement)
const rimArg = process.argv.includes('--rim') ? process.argv[process.argv.indexOf('--rim') + 1].split(',').map(Number) : null;
const base = rimArg ? { x: rimArg[0], y: rimArg[1], w: rimArg[2] } : labels.rim_px;
const rim = { x: base.x * k, y: base.y * k, w: base.w * k };
const roi = roiFor(rim, outW, outH);
const scale = scaleFor(rim);
const det = createDetector(rim, roi, scale);
const { W, H } = det.size;

const proc = spawn(ffmpeg, [
  '-loglevel', 'error', '-i', video, '-vf',
  `fps=30,scale=${outW}:${outH},crop=${roi.w}:${roi.h}:${roi.x}:${roi.y},scale=${W}:${H},format=gray`,
  '-f', 'rawvideo', '-',
]);

const shots = [];
let buf = Buffer.alloc(0);
let frame = 0;
proc.stdout.on('data', (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  while (buf.length >= W * H) {
    const gray = new Uint8Array(buf.subarray(0, W * H));
    buf = buf.subarray(W * H);
    shots.push(...det.push(gray, frame++ / 30).shots);
  }
});
proc.on('close', () => {
  shots.push(...det.flush(frame / 30));
  if (labelsPath === '-') {
    const fmt = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;
    shots.forEach((d) => console.log(`${fmt(d.t)} ${d.made ? 'M' : 'R'}`));
    console.log(`\n${video} : ${shots.length} tirs, ${shots.filter((d) => d.made).length} marqués`);
    return;
  }
  const used = new Set();
  let ok = 0;
  for (const s of labels.shots) {
    const i = shots.findIndex((d, k) => !used.has(k) && Math.abs(d.t - s.t) < 3);
    if (i < 0) {
      console.log(`${s.t.toFixed(1).padStart(6)}s ${s.made ? 'M' : 'R'} → NON DÉTECTÉ`);
      continue;
    }
    used.add(i);
    const good = shots[i].made === s.made;
    ok += good;
    console.log(`${s.t.toFixed(1).padStart(6)}s ${s.made ? 'M' : 'R'} → ${shots[i].made ? 'M' : 'R'} ${good ? '✓' : '✗'}`);
  }
  const extra = shots.filter((_, k) => !used.has(k));
  extra.forEach((d) => console.log(`${d.t.toFixed(1).padStart(6)}s (pas un tir) → faux tir`));
  console.log(`\n${video} : ${ok}/${labels.shots.length} bien classés, ${extra.length} faux tirs (${outH}p, zone ${W}x${H})`);
});
