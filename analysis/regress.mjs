// Rejoue toutes les vidéos relevées (analysis/truth.json) avec le détecteur de l'app et affiche le score.
// Usage : node analysis/regress.mjs --ffmpeg /chemin/ffmpeg [--jobs 8] [--only 20261015]
import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

const opt = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d);
const ffmpeg = opt('--ffmpeg', 'ffmpeg');
const jobs = +opt('--jobs', 8);
const only = opt('--only', '');
const { videos } = JSON.parse(readFileSync(new URL('./truth.json', import.meta.url)));
const file = (k) => [`videos/${k}.mp4`, `videos/VID_${k}.mp4`].find(existsSync);
const todo = Object.entries(videos).filter(([k]) => k.includes(only) && file(k));

const run = ([k, v]) =>
  new Promise((done) => {
    const p = spawn('node', ['analysis/check-js.mjs', file(k), '-', '--ffmpeg', ffmpeg, '--rim', v.rim.join(',')]);
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.on('close', () => {
      const m = out.match(/(\d+) tirs, (\d+) marqués/);
      done({ k, truth: v.truth, got: m ? [+m[1], +m[2]] : null, shots: out.split('\n').filter((l) => /^\d+:/.test(l)) });
    });
  });

const results = [];
const queue = [...todo];
await Promise.all(Array.from({ length: jobs }, async () => { while (queue.length) results.push(await run(queue.shift())); }));
results.sort((a, b) => a.k.localeCompare(b.k));
let ok = 0;
for (const r of results) {
  const good = r.got && r.got[0] === r.truth[0] && r.got[1] === r.truth[1];
  ok += good;
  console.log(`${good ? '✓' : '✗'} ${r.k.padEnd(20)} relevé ${r.truth.join('/').padEnd(6)} Swish ${r.got ? r.got.join('/') : '?'}`);
}
console.log(`\n${ok}/${results.length} vidéos exactes`);
