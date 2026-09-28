import './style.css';
import { store } from './store.js';
import { summarize, splits, overall } from './stats.js';
import { progressChart, bindChart } from './chart.js';

const app = document.getElementById('app');

const fmtDay = (t) =>
  new Date(t).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
const fmtTime = (t) => new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const fmtDuration = (ms) => {
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}:${String(s).padStart(2, '0')}`;
};

// ---------- Routage (#/, #/seance, #/s/<id>) ----------

function route() {
  stopTimer();
  releaseWakeLock();
  const hash = location.hash || '#/';
  if (hash === '#/seance') {
    if (!store.active) return go('#/');
    renderSession();
    timer = setInterval(() => {
      const el = app.querySelector('[data-timer]');
      if (el) el.textContent = fmtDuration(Date.now() - store.active.startedAt);
    }, 1000);
    requestWakeLock();
    return;
  }
  const m = hash.match(/^#\/s\/(.+)$/);
  if (m) return renderDetail(m[1]);
  renderHome();
}

function go(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

window.addEventListener('hashchange', route);

// ---------- Accueil ----------

function renderHome() {
  const sessions = store.sessions;
  const o = overall(sessions);
  const points = sessions
    .slice(0, 20)
    .reverse()
    .map((s) => ({ ...summarize(s.shots), startedAt: s.startedAt }));

  app.innerHTML = `
    <header class="top">
      <h1>Splash</h1>
      <span class="muted">Tirs à 3 points</span>
    </header>

    <button class="cta" data-action="start">
      ${store.active ? 'Reprendre la séance' : 'Nouvelle séance'}
    </button>

    ${
      sessions.length
        ? `
    <section class="tiles">
      <div class="tile"><span class="tile-value">${o.pct}%</span><span class="tile-label">Réussite globale</span></div>
      <div class="tile"><span class="tile-value">${o.attempts}</span><span class="tile-label">Tirs · ${o.sessions} séance${o.sessions > 1 ? 's' : ''}</span></div>
      <div class="tile"><span class="tile-value">${o.bestPct ?? '–'}${o.bestPct !== null ? '%' : ''}</span><span class="tile-label">Meilleure séance</span></div>
      <div class="tile"><span class="tile-value">${o.bestStreak}</span><span class="tile-label">Meilleure série</span></div>
    </section>

    <section class="card">
      <h2>Progression</h2>
      ${progressChart(points)}
    </section>

    <section class="card">
      <h2>Historique</h2>
      <ul class="history">
        ${sessions
          .map((s) => {
            const r = summarize(s.shots);
            return `<li><a href="#/s/${s.id}">
              <span><strong>${fmtDay(s.startedAt)}</strong> <span class="muted">${fmtTime(s.startedAt)}</span></span>
              <span class="muted">${r.made}/${r.attempts}</span>
              <span class="pct">${r.pct}%</span>
            </a></li>`;
          })
          .join('')}
      </ul>
    </section>`
        : `<p class="muted intro">Lance ta première séance : tape <b>Marqué</b> ou <b>Raté</b> après chaque tir, l'app calcule ton pourcentage et suit ta progression.</p>`
    }

    <footer class="backup">
      <button class="link" data-action="export" ${sessions.length ? '' : 'hidden'}>Exporter mes données</button>
      <label class="link">Importer<input type="file" accept="application/json" data-action="import" hidden></label>
    </footer>`;

  bindChart(app);
}

// ---------- Séance en cours ----------

let timer = null;
let lastTap = 0;

function stopTimer() {
  clearInterval(timer);
  timer = null;
}

function renderSession() {
  const s = store.active;
  const r = summarize(s.shots);
  const recent = s.shots.slice(-12);

  app.innerHTML = `
    <div class="session">
      <header class="session-bar">
        <span class="timer" data-timer>${fmtDuration(Date.now() - s.startedAt)}</span>
        <button class="ghost" data-action="end">Terminer</button>
      </header>

      <section class="scoreboard" aria-live="polite">
        <div class="big-pct">${r.pct}<small>%</small></div>
        <div class="score">${r.made} <span class="muted">/ ${r.attempts} tirs</span></div>
        <div class="mini-stats">
          <span><b>${r.missed}</b> ratés</span>
          <span><b>${r.streak}</b> série</span>
          <span><b>${r.bestStreak}</b> record</span>
        </div>
        <div class="recent" aria-label="Derniers tirs">
          ${recent.map((x) => `<i class="${x.m ? 'in' : 'out'}"></i>`).join('')}
        </div>
      </section>

      <button class="ghost undo" data-action="undo" ${s.shots.length ? '' : 'disabled'}>↶ Annuler le dernier tir</button>

      <div class="pads">
        <button class="pad miss" data-action="miss">Raté</button>
        <button class="pad make" data-action="make">Marqué</button>
      </div>
    </div>`;
}

function shot(made) {
  // Anti double-tap : ignore un 2e appui dans les 300 ms.
  const now = Date.now();
  if (now - lastTap < 300) return;
  lastTap = now;
  store.addShot(made);
  navigator.vibrate?.(made ? 40 : [25, 60, 25]);
  renderSession();
  app.querySelector(made ? '.make' : '.miss')?.classList.add('flash');
}

// ---------- Détail d'une séance ----------

function renderDetail(id) {
  const s = store.getSession(id);
  if (!s) return go('#/');
  const r = summarize(s.shots);
  const parts = splits(s.shots);

  app.innerHTML = `
    <header class="top">
      <a class="back" href="#/">← Accueil</a>
    </header>
    <h1 class="detail-title">${fmtDay(s.startedAt)} <span class="muted">${fmtTime(s.startedAt)}</span></h1>

    <section class="tiles">
      <div class="tile"><span class="tile-value">${r.pct}%</span><span class="tile-label">Réussite</span></div>
      <div class="tile"><span class="tile-value">${r.made}/${r.attempts}</span><span class="tile-label">Marqués / tirés</span></div>
      <div class="tile"><span class="tile-value">${r.bestStreak}</span><span class="tile-label">Meilleure série</span></div>
      <div class="tile"><span class="tile-value">${fmtDuration((s.endedAt ?? s.startedAt) - s.startedAt)}</span><span class="tile-label">Durée</span></div>
    </section>

    <section class="card">
      <h2>Par tranche de 10 tirs</h2>
      <table class="splits">
        ${parts
          .map(
            (p) => `<tr>
              <td class="muted">${p.from}–${p.to}</td>
              <td class="bar-cell"><span class="bar" style="width:${p.pct}%"></span></td>
              <td>${p.made}/${p.attempts}</td>
              <td class="pct">${p.pct}%</td>
            </tr>`,
          )
          .join('')}
      </table>
    </section>

    <section class="card">
      <h2>Tous les tirs</h2>
      <div class="recent all">${s.shots.map((x) => `<i class="${x.m ? 'in' : 'out'}"></i>`).join('')}</div>
    </section>

    <button class="danger" data-action="delete" data-id="${s.id}">Supprimer cette séance</button>`;
}

// ---------- Actions ----------

app.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  switch (btn.dataset.action) {
    case 'start':
      store.startSession();
      go('#/seance');
      break;
    case 'make':
      shot(true);
      break;
    case 'miss':
      shot(false);
      break;
    case 'undo':
      store.undo();
      renderSession();
      break;
    case 'end': {
      if (store.active.shots.length && !confirm('Terminer la séance ?')) return;
      const done = store.endSession();
      go(done ? `#/s/${done.id}` : '#/');
      break;
    }
    case 'delete':
      if (confirm('Supprimer définitivement cette séance ?')) {
        store.deleteSession(btn.dataset.id);
        go('#/');
      }
      break;
    case 'export':
      exportData();
      break;
  }
});

app.addEventListener('change', async (e) => {
  if (e.target.dataset.action !== 'import' || !e.target.files[0]) return;
  try {
    const n = store.importJSON(await e.target.files[0].text());
    alert(`${n} séance${n > 1 ? 's' : ''} importée${n > 1 ? 's' : ''}.`);
  } catch {
    alert("Ce fichier n'est pas une sauvegarde Splash valide.");
  }
  route();
});

async function exportData() {
  const name = `splash-${new Date().toISOString().slice(0, 10)}.json`;
  const file = new File([store.exportJSON()], name, { type: 'application/json' });
  // Sur Android : feuille de partage (Drive, mail…). Sinon : téléchargement.
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Sauvegarde Splash' });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ---------- Écran toujours allumé pendant la séance ----------

let wakeLock = null;

async function requestWakeLock() {
  try {
    wakeLock = await navigator.wakeLock?.request('screen');
  } catch {
    // refusé (batterie faible, etc.) : pas bloquant
  }
}

function releaseWakeLock() {
  wakeLock?.release();
  wakeLock = null;
}

// Le verrou saute quand l'app passe en arrière-plan : on le reprend au retour.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && location.hash === '#/seance') requestWakeLock();
});

// ---------- Mode hors ligne ----------

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('./sw.js');
}

route();
