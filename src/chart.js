// Courbe de progression : % de réussite par séance, de la plus ancienne à la plus récente.
// SVG fait main, une seule série, tooltip au toucher.

const W = 320;
const H = 150;
const PAD = { top: 12, right: 12, bottom: 22, left: 30 };

const fmtDate = (t) => new Date(t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });

export function progressChart(points) {
  if (points.length < 2) {
    return `<p class="muted chart-empty">La courbe apparaîtra après ta 2<sup>e</sup> séance.</p>`;
  }
  const iw = W - PAD.left - PAD.right;
  const ih = H - PAD.top - PAD.bottom;
  const x = (i) => PAD.left + (points.length === 1 ? iw / 2 : (i / (points.length - 1)) * iw);
  const y = (v) => PAD.top + ih - (v / 100) * ih;

  const grid = [0, 50, 100]
    .map(
      (v) => `<line class="grid" x1="${PAD.left}" x2="${W - PAD.right}" y1="${y(v)}" y2="${y(v)}"/>
        <text class="axis" x="${PAD.left - 6}" y="${y(v) + 4}" text-anchor="end">${v}%</text>`,
    )
    .join('');
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.pct).toFixed(1)}`).join('');
  const dots = points
    .map((p, i) => `<circle class="dot" cx="${x(i)}" cy="${y(p.pct)}" r="4" data-i="${i}"/>`)
    .join('');
  const first = points[0];
  const last = points[points.length - 1];

  return `
    <div class="chart" data-points='${JSON.stringify(points.map((p) => [p.pct, p.attempts, p.startedAt]))}'>
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Pourcentage de réussite par séance, de ${first.pct}% à ${last.pct}%">
        ${grid}
        <text class="axis" x="${PAD.left}" y="${H - 4}">${fmtDate(first.startedAt)}</text>
        <text class="axis" x="${W - PAD.right}" y="${H - 4}" text-anchor="end">${fmtDate(last.startedAt)}</text>
        <line class="crosshair" y1="${PAD.top}" y2="${PAD.top + ih}" hidden/>
        <path class="line" d="${line}"/>
        ${dots}
        <rect class="hit" x="${PAD.left - 10}" y="0" width="${iw + 20}" height="${H}"/>
      </svg>
      <div class="tooltip" hidden></div>
    </div>`;
}

// Branche le tooltip (appelé après insertion dans le DOM).
export function bindChart(root) {
  const el = root.querySelector('.chart');
  if (!el) return;
  const pts = JSON.parse(el.dataset.points);
  const svg = el.querySelector('svg');
  const tip = el.querySelector('.tooltip');
  const cross = el.querySelector('.crosshair');
  const dots = [...el.querySelectorAll('.dot')];

  const show = (evt) => {
    const box = svg.getBoundingClientRect();
    const vx = ((evt.clientX - box.left) / box.width) * W;
    const iw = W - PAD.left - PAD.right;
    const i = Math.max(0, Math.min(pts.length - 1, Math.round(((vx - PAD.left) / iw) * (pts.length - 1))));
    const [p, n, t] = pts[i];
    const cx = +dots[i].getAttribute('cx');
    dots.forEach((d, j) => d.classList.toggle('active', j === i));
    cross.setAttribute('x1', cx);
    cross.setAttribute('x2', cx);
    cross.hidden = false;
    tip.innerHTML = `<strong>${p}%</strong> <span>${n} tirs · ${fmtDate(t)}</span>`;
    tip.hidden = false;
    const left = (cx / W) * box.width;
    tip.style.left = `${Math.max(60, Math.min(box.width - 60, left))}px`;
  };
  const hide = () => {
    tip.hidden = true;
    cross.hidden = true;
    dots.forEach((d) => d.classList.remove('active'));
  };
  svg.addEventListener('pointerdown', show);
  svg.addEventListener('pointermove', show);
  // Au doigt, le tooltip reste affiché après le toucher ; il ne disparaît qu'à la souris.
  svg.addEventListener('pointerleave', (e) => e.pointerType === 'mouse' && hide());
}
