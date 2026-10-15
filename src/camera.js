// Mode caméra : le téléphone filme le panier et compte tout seul les tirs.
// 1. calibrage : on touche le panier, l'écran zoome dessus, on touche les deux bords du cercle ;
// 2. à chaque image, la zone autour du cercle passe dans le détecteur (src/detect/core.js).

import { createDetector, roiFor, scaleFor } from './detect/core.js';

const RIM_KEY = 'swish:rim';
const ZOOM_KEY = 'swish:zoom';
const MIN_RIM = 20; // px vidéo : en dessous, le ballon est trop petit pour être suivi

function loadRim(vw, vh, zoom) {
  try {
    const r = JSON.parse(localStorage.getItem(RIM_KEY));
    if (r && r.vw === vw && r.vh === vh && (r.zoom ?? 1) === zoom) return r;
  } catch {
    // réglage illisible : on recalibre
  }
  return null;
}

// Traitement d'une image : découpe de la zone du panier, niveaux de gris, détecteur.
// source : tout ce que drawImage accepte (vidéo, image). Séparé de la caméra pour pouvoir le tester.
export function createFrameProcessor(rim, videoW, videoH) {
  const roi = roiFor(rim, videoW, videoH);
  const det = createDetector(rim, roi, scaleFor(rim));
  const { W, H } = det.size;
  // Deux façons de lire les pixels ; selon le téléphone, l'une est bien plus rapide que l'autre.
  // « cpu » : canvas logiciel (l'image vidéo entière est rapatriée) ; « gpu » : canvas accéléré
  // (seule la petite zone est rapatriée).
  const ctxs = {};
  for (const mode of ['cpu', 'gpu']) {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    ctxs[mode] = c.getContext('2d', { willReadFrequently: mode === 'cpu' });
  }
  const gray = new Uint8Array(W * H);
  const cost = { cpu: [], gpu: [] };
  let mode = 'cpu';
  let n = 0;
  return {
    roi,
    get mode() {
      return mode;
    },
    push(source, t) {
      const t0 = performance.now();
      const ctx = ctxs[mode];
      ctx.drawImage(source, roi.x, roi.y, roi.w, roi.h, 0, 0, W, H);
      const px = ctx.getImageData(0, 0, W, H).data;
      for (let i = 0, j = 0; i < gray.length; i++, j += 4) {
        gray[i] = (px[j] * 77 + px[j + 1] * 150 + px[j + 2] * 29) >> 8; // luminance
      }
      // Essai : 15 images avec chaque méthode, puis on garde la plus rapide.
      if (n < 30) {
        cost[mode].push(performance.now() - t0);
        n++;
        if (n === 15) mode = 'gpu';
        if (n === 30) {
          const avg = (a) => a.reduce((s, v) => s + v, 0) / a.length;
          mode = avg(cost.cpu) <= avg(cost.gpu) ? 'cpu' : 'gpu';
        }
      }
      return det.push(gray, t);
    },
    flush: () => det.flush(),
  };
}

// root : élément de l'écran caméra (vidéo, calque, boutons). onShot(made) à chaque tir détecté ;
// onStatus(texte) pour les consignes.
export async function startCamera(root, { onShot, onStatus }) {
  const video = root.querySelector('.cam-video');
  const overlay = root.querySelector('.cam-overlay');
  const okBtn = root.querySelector('[data-cam-ok]');
  const zoomBox = root.querySelector('[data-cam-zoom]');
  const octx = overlay.getContext('2d');

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false, // le micro reste libre pour la commande vocale
    video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
  });
  video.srcObject = stream;
  await video.play();

  // Zoom de la caméra (si le téléphone le permet) : grossit le panier quand on filme de loin.
  const track = stream.getVideoTracks()[0];
  const zoomCap = track.getCapabilities?.().zoom;
  let zoom = 1;
  if (zoomCap) {
    zoom = Math.min(zoomCap.max, Math.max(zoomCap.min, +localStorage.getItem(ZOOM_KEY) || zoomCap.min));
    await track.applyConstraints({ advanced: [{ zoom }] }).catch(() => {});
    zoomBox.hidden = false;
  }

  const vw = () => video.videoWidth;
  const vh = () => video.videoHeight;

  let rim = loadRim(vw(), vh(), zoom);
  // Étapes : 'aim' (toucher le panier) → 'zoom' (loupe : valider ou corriger) → 'run' (comptage).
  let step = 'aim';
  let lens = null; // fenêtre agrandie pendant le calibrage : { x, y, w, h } en px vidéo
  let guess = null; // cercle proposé pendant le calibrage
  let edges = []; // bords touchés dans la loupe
  let proc = null;
  let trail = []; // dernières positions du ballon, pour tracer sa trajectoire
  let stopped = false;
  let fpsCount = 0;
  let fpsT = performance.now();
  let fps = 0;
  let ms = 0; // temps moyen de traitement d'une image

  function run() {
    step = 'run';
    okBtn.hidden = true;
    proc = createFrameProcessor(rim, vw(), vh());
    trail = [];
    onStatus('Prêt : tire, Swish compte tout seul.');
  }

  function aim() {
    step = 'aim';
    proc = null;
    lens = null;
    okBtn.hidden = true;
    onStatus('Touche le panier : l’écran va zoomer dessus.');
  }

  function openLens(p) {
    const box = overlay.getBoundingClientRect();
    const w = 0.16 * vw(); // ~6x : les bords du cercle se visent facilement
    const h = Math.min(vh(), (w * box.height) / box.width);
    lens = {
      x: Math.min(vw() - w, Math.max(0, p.x - w / 2)),
      y: Math.min(vh() - h, Math.max(0, p.y - h / 2)),
      w,
      h,
    };
    step = 'zoom';
    edges = [];
    // Pas de proposition automatique : à contre-jour, la couleur du cercle n'est pas fiable
    // (testé sur les captures du terrain) ; deux touchers dans la loupe sont sûrs.
    guess = null;
    okBtn.hidden = true;
    onStatus('Touche le bord GAUCHE du cercle, puis son bord DROIT.');
  }

  // Toucher → pixels vidéo, selon ce qui est affiché (vidéo entière ou loupe).
  function toVideo(e) {
    const box = overlay.getBoundingClientRect();
    if (step === 'zoom') {
      return { x: lens.x + ((e.clientX - box.left) / box.width) * lens.w, y: lens.y + ((e.clientY - box.top) / box.height) * lens.h };
    }
    const k = Math.min(box.width / vw(), box.height / vh());
    return {
      x: (e.clientX - box.left - (box.width - vw() * k) / 2) / k,
      y: (e.clientY - box.top - (box.height - vh() * k) / 2) / k,
    };
  }

  function onTap(e) {
    if (step === 'run') return;
    const p = toVideo(e);
    if (p.x < 0 || p.y < 0 || p.x > vw() || p.y > vh()) return;
    if (step === 'aim') return openLens(p);

    // Dans la loupe : deux touchers = bords gauche et droit du cercle.
    if (edges.length === 2) edges = [];
    edges.push(p);
    if (edges.length === 1) {
      onStatus('Touche maintenant le bord DROIT du cercle.');
      return;
    }
    const [a, b] = edges;
    const w = Math.abs(b.x - a.x);
    if (w < MIN_RIM) {
      edges = [];
      onStatus('Cercle trop petit à l’image : rapproche le téléphone ou zoome (+). Touche le bord GAUCHE.');
      return;
    }
    guess = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, w };
    okBtn.hidden = false;
    onStatus('Touche « Valider » si l’ellipse suit bien le cercle, ou touche à nouveau les deux bords.');
  }

  function confirm() {
    if (step !== 'zoom' || !guess) return;
    rim = { ...guess, vw: vw(), vh: vh(), zoom };
    localStorage.setItem(RIM_KEY, JSON.stringify(rim));
    run();
  }

  async function changeZoom(dir) {
    if (!zoomCap) return;
    const inc = Math.max(zoomCap.step || 0.1, 0.5);
    zoom = Math.min(zoomCap.max, Math.max(zoomCap.min, Math.round((zoom + dir * inc) * 10) / 10));
    await track.applyConstraints({ advanced: [{ zoom }] }).catch(() => {});
    localStorage.setItem(ZOOM_KEY, String(zoom));
    aim(); // le cadrage a changé : il faut retoucher le panier
  }

  const onZoom = (e) => {
    const dir = e.target.closest('[data-zoom]')?.dataset.zoom;
    if (dir) changeZoom(+dir);
  };
  overlay.addEventListener('pointerdown', onTap);
  okBtn.addEventListener('click', confirm);
  zoomBox.addEventListener('click', onZoom);

  if (rim) run();
  else aim();

  function draw() {
    const box = overlay.getBoundingClientRect();
    if (overlay.width !== Math.round(box.width) || overlay.height !== Math.round(box.height)) {
      overlay.width = Math.round(box.width);
      overlay.height = Math.round(box.height);
    }
    octx.clearRect(0, 0, overlay.width, overlay.height);
    octx.lineWidth = 3;

    if (step === 'zoom') {
      // Loupe : la zone du panier remplit l'écran.
      octx.drawImage(video, lens.x, lens.y, lens.w, lens.h, 0, 0, overlay.width, overlay.height);
      const X = (x) => ((x - lens.x) / lens.w) * overlay.width;
      const Y = (y) => ((y - lens.y) / lens.h) * overlay.height;
      const k = overlay.width / lens.w;
      if (guess) {
        octx.strokeStyle = '#ff7a2e';
        octx.beginPath();
        octx.ellipse(X(guess.x), Y(guess.y), (guess.w / 2) * k, (guess.w / 7) * k, 0, 0, Math.PI * 2);
        octx.stroke();
      }
      octx.fillStyle = '#fff';
      octx.strokeStyle = '#000';
      edges.forEach((p) => {
        octx.beginPath();
        octx.arc(X(p.x), Y(p.y), 7, 0, Math.PI * 2);
        octx.fill();
        octx.stroke();
      });
      return;
    }

    const k = Math.min(box.width / vw(), box.height / vh());
    const ox = (box.width - vw() * k) / 2;
    const oy = (box.height - vh() * k) / 2;
    const X = (x) => ox + x * k;
    const Y = (y) => oy + y * k;

    if (step === 'run') {
      const { roi } = proc;
      octx.strokeStyle = 'rgba(255,255,255,0.5)';
      octx.setLineDash([6, 6]);
      octx.strokeRect(X(roi.x), Y(roi.y), roi.w * k, roi.h * k);
      octx.setLineDash([]);
      octx.strokeStyle = '#ff7a2e';
      octx.beginPath();
      octx.ellipse(X(rim.x), Y(rim.y), (rim.w / 2) * k, (rim.w / 7) * k, 0, 0, Math.PI * 2);
      octx.stroke();

      // Trajectoire du ballon sur la dernière seconde et demie.
      const now = performance.now();
      trail = trail.filter((p) => now - p.at < 1500);
      if (trail.length > 1) {
        octx.strokeStyle = '#ffd43b';
        octx.lineJoin = 'round';
        octx.beginPath();
        trail.forEach((p, i) => (i ? octx.lineTo(X(p.x), Y(p.y)) : octx.moveTo(X(p.x), Y(p.y))));
        octx.stroke();
      }
      const last = trail[trail.length - 1];
      if (last && now - last.at < 300) {
        octx.strokeStyle = '#2f9e4f';
        octx.beginPath();
        octx.arc(X(last.x), Y(last.y), Math.max(4, 0.2 * rim.w * k), 0, Math.PI * 2);
        octx.stroke();
      }
    }

    // Infos techniques, utiles sur une capture d'écran en cas de problème.
    const info = [`${fps} i/s`, `${vw()}×${vh()}`];
    if (zoomCap) info.push(`zoom ×${zoom}`);
    if (step === 'run') info.push(`cercle ${Math.round(rim.w)} px`, `${ms.toFixed(1)} ms (${proc.mode})`);
    octx.fillStyle = 'rgba(255,255,255,0.8)';
    octx.font = '12px system-ui';
    octx.textAlign = 'center';
    octx.fillText(info.join(' · '), overlay.width / 2, overlay.height - 8);
    octx.textAlign = 'start';
  }

  function frame(now, meta) {
    if (stopped) return;
    const t = meta?.mediaTime ?? now / 1000;
    if (step === 'run') {
      const t0 = performance.now();
      const r = proc.push(video, t);
      ms += (performance.now() - t0 - ms) * 0.1;
      if (r.ball) {
        // Un saut trop grand = autre objet : on repart d'une nouvelle trajectoire.
        const last = trail[trail.length - 1];
        if (last && Math.hypot(r.ball.x - last.x, r.ball.y - last.y) > 1.5 * rim.w) trail = [];
        trail.push({ ...r.ball, at: performance.now() });
      }
      r.shots.forEach((s) => onShot(s.made));
    }
    fpsCount++;
    if (now - fpsT > 1000) {
      fps = fpsCount;
      fpsCount = 0;
      fpsT = now;
    }
    draw();
    schedule();
  }

  const schedule = () =>
    video.requestVideoFrameCallback
      ? video.requestVideoFrameCallback((now, meta) => frame(now, meta))
      : requestAnimationFrame((now) => frame(now));
  schedule();

  return {
    recalibrate: aim,
    stop() {
      stopped = true;
      overlay.removeEventListener('pointerdown', onTap);
      okBtn.removeEventListener('click', confirm);
      zoomBox.removeEventListener('click', onZoom);
      // le dernier tir en attente de verdict est compté
      proc?.flush().forEach((s) => onShot(s.made));
      stream.getTracks().forEach((tr) => tr.stop());
      video.srcObject = null;
    },
  };
}
