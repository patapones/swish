// Mode caméra : le téléphone filme le panier et compte tout seul les tirs.
// 1. calibrage : on touche le bord gauche puis le bord droit du cercle ;
// 2. à chaque image, la zone autour du cercle passe dans le détecteur (src/detect/core.js).

import { createDetector, roiFor, scaleFor } from './detect/core.js';
import { findRim } from './detect/rim.js';

const RIM_KEY = 'swish:rim';

function loadRim(vw, vh) {
  try {
    const r = JSON.parse(localStorage.getItem(RIM_KEY));
    if (r && r.vw === vw && r.vh === vh) return r;
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
  const work = document.createElement('canvas');
  work.width = det.size.W;
  work.height = det.size.H;
  const wctx = work.getContext('2d', { willReadFrequently: true });
  const gray = new Uint8Array(work.width * work.height);
  return {
    roi,
    push(source, t) {
      wctx.drawImage(source, roi.x, roi.y, roi.w, roi.h, 0, 0, work.width, work.height);
      const px = wctx.getImageData(0, 0, work.width, work.height).data;
      for (let i = 0, j = 0; i < gray.length; i++, j += 4) {
        gray[i] = (px[j] * 77 + px[j + 1] * 150 + px[j + 2] * 29) >> 8; // luminance
      }
      return det.push(gray, t);
    },
    flush: () => det.flush(),
  };
}

// Coordonnées d'un toucher → pixels de la vidéo (la vidéo est affichée en « contain »).
function toVideo(video, clientX, clientY) {
  const box = video.getBoundingClientRect();
  const k = Math.min(box.width / video.videoWidth, box.height / video.videoHeight);
  const ox = (box.width - video.videoWidth * k) / 2;
  const oy = (box.height - video.videoHeight * k) / 2;
  return { x: (clientX - box.left - ox) / k, y: (clientY - box.top - oy) / k, k, ox, oy };
}

// root : élément qui contient .cam-video, .cam-overlay et .cam-hint.
// onShot(made) à chaque tir détecté ; onStatus(texte) pour les consignes.
export async function startCamera(root, { onShot, onStatus }) {
  const video = root.querySelector('.cam-video');
  const overlay = root.querySelector('.cam-overlay');
  const octx = overlay.getContext('2d');

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false, // le micro reste libre pour la commande vocale
    video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
  });
  video.srcObject = stream;
  await video.play();

  let rim = loadRim(video.videoWidth, video.videoHeight);
  // Calibrage : un toucher approximatif suffit (le cercle est trouvé par sa couleur) ;
  // à défaut, on touche ses bords gauche et droit. null = calibré.
  let calib = null;
  let proc = null;
  let lastBall = null;
  let stopped = false;
  let fpsCount = 0;
  let fpsT = performance.now();
  let fps = 0;

  function setup() {
    proc = createFrameProcessor(rim, video.videoWidth, video.videoHeight);
    onStatus('Prêt : tire, Swish compte tout seul.');
  }

  function askCalibration() {
    calib = { manual: false, points: [] };
    proc = null;
    onStatus('Touche le cercle du panier (pas besoin d’être précis).');
  }

  function useRim(r) {
    rim = { ...r, vw: video.videoWidth, vh: video.videoHeight };
    localStorage.setItem(RIM_KEY, JSON.stringify(rim));
    calib = null;
    setup();
  }

  // Cherche le cercle dans une fenêtre autour du toucher, sur l'image en pleine résolution.
  function autoRim(p) {
    const R = Math.round(0.12 * video.videoWidth);
    const x0 = Math.max(0, Math.round(p.x - R));
    const y0 = Math.max(0, Math.round(p.y - R));
    const W = Math.min(video.videoWidth, Math.round(p.x + R)) - x0;
    const H = Math.min(video.videoHeight, Math.round(p.y + R)) - y0;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const cx = c.getContext('2d', { willReadFrequently: true });
    cx.drawImage(video, x0, y0, W, H, 0, 0, W, H);
    const r = findRim(cx.getImageData(0, 0, W, H).data, W, H, { x: p.x - x0, y: p.y - y0 });
    return r && r.w >= 24 ? { x: r.x + x0, y: r.y + y0, w: r.w } : null;
  }

  if (rim) setup();
  else askCalibration();

  function onTap(e) {
    if (!calib) return;
    const p = toVideo(video, e.clientX, e.clientY);
    if (p.x < 0 || p.y < 0 || p.x > video.videoWidth || p.y > video.videoHeight) return;

    if (!calib.manual) {
      const found = autoRim(p);
      if (found) {
        useRim(found);
        onStatus('Cercle trouvé. Si l’ellipse orange n’est pas sur le cercle, touche « Recalibrer ».');
      } else {
        calib = { manual: true, points: [] };
        onStatus('Cercle non trouvé automatiquement. Touche son bord GAUCHE, puis son bord DROIT.');
      }
      return;
    }

    calib.points.push(p);
    if (calib.points.length === 1) {
      onStatus('Touche le bord DROIT du cercle.');
      return;
    }
    const [a, b] = calib.points;
    const w = Math.abs(b.x - a.x);
    if (w < 24) {
      onStatus('Cercle trop petit à l’image : rapproche le téléphone. Touche le bord GAUCHE.');
      calib.points = [];
      return;
    }
    useRim({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, w });
  }
  overlay.addEventListener('pointerdown', onTap);

  // Dessin : cercle calibré, zone analysée, ballon suivi.
  function draw() {
    const box = video.getBoundingClientRect();
    if (overlay.width !== Math.round(box.width) || overlay.height !== Math.round(box.height)) {
      overlay.width = Math.round(box.width);
      overlay.height = Math.round(box.height);
    }
    octx.clearRect(0, 0, overlay.width, overlay.height);
    const k = Math.min(box.width / video.videoWidth, box.height / video.videoHeight);
    const ox = (box.width - video.videoWidth * k) / 2;
    const oy = (box.height - video.videoHeight * k) / 2;
    const X = (x) => ox + x * k;
    const Y = (y) => oy + y * k;

    octx.lineWidth = 3;
    if (calib) {
      octx.fillStyle = '#ff7a2e';
      calib.points.forEach((p) => {
        octx.beginPath();
        octx.arc(X(p.x), Y(p.y), 8, 0, Math.PI * 2);
        octx.fill();
      });
      return;
    }
    if (proc) {
      const { roi } = proc;
      octx.strokeStyle = 'rgba(255,255,255,0.5)';
      octx.setLineDash([6, 6]);
      octx.strokeRect(X(roi.x), Y(roi.y), roi.w * k, roi.h * k);
      octx.setLineDash([]);
    }
    octx.strokeStyle = '#ff7a2e';
    octx.beginPath();
    octx.ellipse(X(rim.x), Y(rim.y), (rim.w / 2) * k, (rim.w / 8) * k, 0, 0, Math.PI * 2);
    octx.stroke();
    if (lastBall && performance.now() - lastBall.at < 300) {
      octx.strokeStyle = '#2f9e4f';
      octx.beginPath();
      octx.arc(X(lastBall.x), Y(lastBall.y), 0.2 * rim.w * k, 0, Math.PI * 2);
      octx.stroke();
    }
    octx.fillStyle = 'rgba(255,255,255,0.7)';
    octx.font = '12px system-ui';
    octx.fillText(`${fps} i/s`, 8, overlay.height - 8);
  }

  function frame(now, meta) {
    if (stopped) return;
    const t = (meta?.mediaTime ?? now / 1000);
    if (proc) {
      const r = proc.push(video, t);
      if (r.ball) lastBall = { ...r.ball, at: performance.now() };
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
    recalibrate: askCalibration,
    stop() {
      stopped = true;
      overlay.removeEventListener('pointerdown', onTap);
      // le dernier tir en attente de verdict est compté
      proc?.flush().forEach((s) => onShot(s.made));
      stream.getTracks().forEach((tr) => tr.stop());
      video.srcObject = null;
    },
  };
}
