// Trouve le cercle du panier près d'un toucher approximatif, grâce à sa couleur rouge/orange.
// Portage de l'outil d'analyse, testé sur les 11 vidéos du terrain.

// Pixel rouge/orange (y compris l'avant du cercle, dans l'ombre).
function isRed(r, g, b) {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  return r >= mx && mx > 38 && (mx - mn) / mx > 0.35 && g < 0.72 * r && b < 0.72 * r;
}

// Dilatation / érosion (voisinage en croix) pour recoller les morceaux du cercle.
function morph(mask, W, H, grow) {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const n = [mask[i], x > 0 ? mask[i - 1] : grow ? 0 : 1, x < W - 1 ? mask[i + 1] : grow ? 0 : 1,
        y > 0 ? mask[i - W] : grow ? 0 : 1, y < H - 1 ? mask[i + W] : grow ? 0 : 1];
      out[i] = grow ? (n.some(Boolean) ? 1 : 0) : n.every(Boolean) ? 1 : 0;
    }
  }
  return out;
}

function boxes(mask, W, H) {
  const seen = new Uint8Array(mask.length);
  const stack = new Int32Array(mask.length);
  const out = [];
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || seen[s]) continue;
    let top = 0;
    stack[top++] = s;
    seen[s] = 1;
    let area = 0, x0 = W, y0 = H, x1 = 0, y1 = 0;
    while (top) {
      const i = stack[--top];
      const x = i % W;
      const y = (i - x) / W;
      area++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1]) {
        if (j >= 0 && mask[j] && !seen[j]) (seen[j] = 1), (stack[top++] = j);
      }
    }
    out.push({ x0, y0, x1: x1 + 1, y1: y1 + 1, area });
  }
  return out;
}

// rgba : pixels (RGBA) d'une fenêtre de l'image ; W, H : sa taille ; tap : toucher dans cette fenêtre.
// Renvoie { x, y, w } (dans la fenêtre) ou null.
export function findRim(rgba, W, H, tap) {
  let mask = new Uint8Array(W * H);
  for (let i = 0, j = 0; i < mask.length; i++, j += 4) mask[i] = isRed(rgba[j], rgba[j + 1], rgba[j + 2]) ? 1 : 0;
  mask = morph(morph(mask, W, H, true), W, H, true);
  mask = morph(morph(mask, W, H, false), W, H, false);
  const comps = boxes(mask, W, H).filter((c) => c.area >= 15);
  const R = Math.max(W, H) / 2;

  // Graine : la tache la plus large et allongée, proche du toucher.
  let best = null;
  let bestScore = 0;
  for (const c of comps) {
    const w = c.x1 - c.x0;
    const h = c.y1 - c.y0;
    if (w < 8 || w / Math.max(h, 1) < 1.3) continue;
    const d = Math.hypot((c.x0 + c.x1) / 2 - tap.x, (c.y0 + c.y1) / 2 - tap.y);
    const score = w / (1 + d / R);
    if (score > bestScore) (best = { ...c }), (bestScore = score);
  }
  if (!best) return null;

  // On agrège les autres morceaux du cercle (avant dans l'ombre, coupures dues au filet).
  for (let grew = true; grew; ) {
    grew = false;
    const w = best.x1 - best.x0;
    for (const c of comps) {
      const inside = c.x0 >= best.x0 && c.y0 >= best.y0 && c.x1 <= best.x1 && c.y1 <= best.y1;
      if (inside || c.y1 - c.y0 > 0.6 * w) continue; // trop haut : toit, maillot…
      const near = c.x0 < best.x1 + 0.3 * w && c.x1 > best.x0 - 0.3 * w && c.y0 < best.y1 + 0.35 * w && c.y1 > best.y0 - 0.35 * w;
      if (near) {
        best = { x0: Math.min(best.x0, c.x0), y0: Math.min(best.y0, c.y0), x1: Math.max(best.x1, c.x1), y1: Math.max(best.y1, c.y1) };
        grew = true;
      }
    }
  }
  return { x: (best.x0 + best.x1) / 2, y: (best.y0 + best.y1) / 2, w: best.x1 - best.x0 };
}
