// Détection des tirs (marqué / raté) à partir d'images en niveaux de gris de la zone du panier.
// Portage de analysis/detect.py, validé sur les vidéos du terrain (12/12 et 11/11).
// Aucune dépendance au navigateur : tourne dans un Web Worker comme dans Node (tests).
//
// Toutes les distances sont en largeurs d'arceau (rw), mesurées en pixels de la vidéo.

const FPS = 30; // cadence de référence des seuils de vitesse
const DIFF = 22; // écart de gris pour qu'un pixel soit « en mouvement »
const OCCLUSION = 0.15; // au-delà, quelqu'un passe devant la caméra
const EXPOSURE = 6; // écart moyen de gris : la caméra a changé d'exposition (ou un nuage passe)
const LOST_AFTER = 0.2; // s sans voir le ballon : trajectoire terminée
const MERGE = 2.5; // s : morceaux de trajectoire d'un même tir
const SETTLE = 3; // s après le tir avant de rendre le verdict

// Zone analysée autour de l'arceau, en pixels vidéo.
export function roiFor(rim, videoW, videoH) {
  const { x, y, w: rw } = rim;
  const x0 = Math.max(0, Math.round(x - 3 * rw));
  const x1 = Math.min(videoW, Math.round(x + 3 * rw));
  const y0 = Math.max(0, Math.round(y - 2.5 * rw));
  const y1 = Math.min(videoH, Math.round(y + 2.5 * rw));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// Réduction appliquée à la zone : l'arceau y fait ~54 px quelle que soit la distance.
export const scaleFor = (rim) => Math.min(1, 54 / rim.w);

// Ouverture morphologique (érosion puis dilatation, voisinage en croix) : enlève les pixels isolés.
function open(mask, W, H) {
  const er = new Uint8Array(mask.length);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      er[i] = mask[i] & mask[i - 1] & mask[i + 1] & mask[i - W] & mask[i + W];
    }
  }
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      out[i] =
        er[i] |
        (x > 0 ? er[i - 1] : 0) |
        (x < W - 1 ? er[i + 1] : 0) |
        (y > 0 ? er[i - W] : 0) |
        (y < H - 1 ? er[i + W] : 0);
    }
  }
  return out;
}

// Taches connexes (voisinage en croix) : surface, boîte, centre.
export function blobs(mask, W, H) {
  const seen = new Uint8Array(mask.length);
  const stack = new Int32Array(mask.length);
  const out = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    let top = 0;
    stack[top++] = start;
    seen[start] = 1;
    let area = 0, sx = 0, sy = 0;
    let minX = W, maxX = 0, minY = H, maxY = 0;
    while (top) {
      const i = stack[--top];
      const x = i % W;
      const y = (i - x) / W;
      area++;
      sx += x;
      sy += y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (x > 0 && mask[i - 1] && !seen[i - 1]) (seen[i - 1] = 1), (stack[top++] = i - 1);
      if (x < W - 1 && mask[i + 1] && !seen[i + 1]) (seen[i + 1] = 1), (stack[top++] = i + 1);
      if (y > 0 && mask[i - W] && !seen[i - W]) (seen[i - W] = 1), (stack[top++] = i - W);
      if (y < H - 1 && mask[i + W] && !seen[i + W]) (seen[i + W] = 1), (stack[top++] = i + W);
    }
    out.push({ area, cx: sx / area, cy: sy / area, w: maxX - minX + 1, h: maxY - minY + 1 });
  }
  return out;
}

// Garde les taches qui ont la taille et la forme d'un ballon.
function ballCandidates(list, rwScaled) {
  const d = 0.37 * rwScaled;
  const expected = Math.PI * (d / 2) ** 2;
  return list.filter(
    (b) =>
      b.area > 0.35 * expected &&
      b.area < 2.5 * expected &&
      b.w / b.h > 0.5 &&
      b.w / b.h < 2 &&
      b.area / (b.w * b.h) >= 0.45, // un ballon remplit bien sa boîte ; une branche non
  );
}

// Juste sous le cercle, le ballon est freiné par le filet au moins 2 images d'affilée.
function heldByNet(tr, i, rim) {
  const { x: cx, y: cy, w: rw } = rim;
  let slow = 0;
  for (let j = i; j < tr.length - 1; j++) {
    if (tr[j].t > tr[i].t + 0.4 || tr[j].y > cy + rw) break;
    const dt = (tr[j + 1].t - tr[j].t) * FPS;
    const dy = (tr[j + 1].y - tr[j].y) / dt;
    const inNet = cy <= tr[j].y && Math.abs(tr[j].x - cx) < 0.6 * rw;
    slow = inNet && dy < 0.12 * rw ? slow + 1 : 0;
    if (slow >= 2) return true;
  }
  return false;
}

// Vitesse de descente entre deux points, en px par image (à 30 i/s).
const fall = (a, b) => (b.y - a.y) / ((b.t - a.t) * FPS);

// Le ballon traverse le filet nettement moins vite qu'il n'est arrivé (swish compris).
// Un ballon qui tombe devant ou derrière le cercle, lui, accélère.
function brakedByNet(tr, i, rim) {
  const { x: cx, y: cy, w: rw } = rim;
  const k = Math.max(0, i - 3);
  if (i - k < 2) return false;
  const vIn = fall(tr[k], tr[i]);
  if (vIn < 0.15 * rw) return false; // pas vraiment en train de descendre
  for (let j = i + 1; j < tr.length; j++) {
    if (tr[j].t > tr[i].t + 0.5 || Math.abs(tr[j].x - cx) > 0.6 * rw) return false;
    if (tr[j].y > cy + 0.8 * rw) return fall(tr[i], tr[j]) < 0.6 * vIn; // sortie du filet
  }
  return false;
}

// Une trajectoire terminée : null si ce n'est pas un tir, sinon { t, made }.
export function judge(tr, rim) {
  const { x: cx, y: cy, w: rw } = rim;
  const aboveRim = tr.filter((p) => Math.abs(p.x - cx) < 2.5 * rw && p.y < cy - 0.2 * rw);
  // Un vrai tir se voit plusieurs images au-dessus du cercle ; sinon : joueur, ballon au sol, reflet…
  if (aboveRim.length < 3) return null;
  // Un ballon tiré bouge : une tache immobile (nuage, changement de lumière) n'est pas un tir.
  let movingSteps = 0;
  for (let i = 1; i < tr.length; i++) {
    const frames = (tr[i].t - tr[i - 1].t) * FPS;
    if (Math.hypot(tr[i].x - tr[i - 1].x, tr[i].y - tr[i - 1].y) / frames > 0.08 * rw) movingSteps++;
  }
  if (movingSteps < 4) return null;
  const above = aboveRim[0];
  let made = false;
  for (let i = 1; i < tr.length; i++) {
    const a = tr[i - 1];
    const b = tr[i];
    if (!(a.y < cy && cy <= b.y)) continue; // descente qui traverse le plan du cercle
    const xCross = a.x + ((cy - a.y) / (b.y - a.y)) * (b.x - a.x);
    // Vu de côté, un ballon qui tombe devant/derrière le cercle semble aussi le traverser :
    // seul le freinage par le filet prouve qu'il est rentré.
    if (Math.abs(xCross - cx) < 0.45 * rw && (heldByNet(tr, i, rim) || brakedByNet(tr, i, rim))) {
      const bouncedOut = tr.some((p) => p.t > b.t + 0.3 && p.y < cy - 0.3 * rw);
      if (!bouncedOut) made = true;
    }
  }
  return { t: above.t, made };
}

// Détecteur temps réel : on lui donne les images une par une, il rend les tirs terminés.
export function createDetector(rim, roi, scale) {
  const W = Math.round(roi.w * scale);
  const H = Math.round(roi.h * scale);
  const rwScaled = rim.w * scale;
  const maxJump = 0.6 * rim.w;
  let bg = null;
  let active = [];
  let pending = null; // tir en cours de regroupement
  let quietUntil = -1; // après un changement de lumière, on ne cherche pas de ballon

  function finishTrack(tr, out) {
    if (tr.length < 4) return;
    const r = judge(tr, rim);
    if (!r) return;
    if (pending && Math.abs(r.t - pending.t) < MERGE) {
      pending.made ||= r.made;
    } else {
      if (pending) out.push(pending);
      pending = { t: r.t, made: r.made };
    }
  }

  return {
    size: { W, H },
    // gray : Uint8Array W*H de la zone réduite. t en secondes. Renvoie { shots, ball, occluded }.
    push(gray, t) {
      const out = [];
      if (!bg) bg = Float32Array.from(gray);
      // Toute l'image s'éclaircit ou s'assombrit d'un coup (exposition automatique, nuage) :
      // on repart de cette image comme fond, sinon le ciel entier ressemble à des ballons.
      let shift = 0;
      for (let i = 0; i < gray.length; i++) shift += gray[i] - bg[i];
      if (Math.abs(shift / gray.length) > EXPOSURE) {
        bg = Float32Array.from(gray);
        quietUntil = t + 0.5; // le temps que l'image se stabilise
      }
      const mask = new Uint8Array(W * H);
      for (let i = 0; i < mask.length; i++) {
        mask[i] = gray[i] < bg[i] && bg[i] - gray[i] > DIFF ? 1 : 0; // le ballon assombrit le ciel
      }
      const fg = open(mask, W, H);
      let moving = 0;
      for (let i = 0; i < fg.length; i++) moving += fg[i];
      const occluded = moving / fg.length > OCCLUSION || t < quietUntil;

      const pts = occluded
        ? []
        : ballCandidates(blobs(fg, W, H), rwScaled).map((b) => ({
            x: roi.x + b.cx / scale,
            y: roi.y + b.cy / scale,
          }));

      // Suivi : chaque trajectoire prend le candidat le plus proche de sa dernière position.
      const used = new Set();
      const still = [];
      for (const tr of active) {
        const last = tr[tr.length - 1];
        if (t - last.t > LOST_AFTER) {
          finishTrack(tr, out);
          continue;
        }
        let best = -1;
        let bd = maxJump * (t - last.t) * FPS;
        pts.forEach((p, j) => {
          const d = Math.hypot(p.x - last.x, p.y - last.y);
          if (!used.has(j) && d < bd) (best = j), (bd = d);
        });
        if (best >= 0) {
          used.add(best);
          tr.push({ t, ...pts[best] });
        }
        still.push(tr);
      }
      pts.forEach((p, j) => used.has(j) || still.push([{ t, ...p }]));
      active = still;

      // Verdict une fois le ballon retombé (plus de trajectoire en cours), 8 s au plus tard.
      const busy = active.some((tr) => tr.length >= 4);
      if (pending && t - pending.t > SETTLE && (!busy || t - pending.t > 8)) {
        out.push(pending);
        pending = null;
      }

      // Le fond suit lentement le décor (nuages, feuillage), presque pas là où ça bouge.
      for (let i = 0; i < bg.length; i++) bg[i] += (fg[i] ? 0.005 : 0.08) * (gray[i] - bg[i]);

      return { shots: out, ball: pts[0] ?? null, occluded };
    },
    // Fin de séance : rend le tir en attente.
    flush(t) {
      const out = [];
      for (const tr of active) finishTrack(tr, out);
      active = [];
      if (pending) out.push(pending);
      pending = null;
      return out;
    },
  };
}
