import './style.css';
import { store } from './store.js';
import { summarize, splits, overall } from './stats.js';
import { progressChart, bindChart } from './chart.js';
import { createVoice, voiceSupported } from './voice.js';
import { createOfflineVoice, listMics, guessHeadset } from './offline-voice.js';
import { beep, announce, unlockAudio } from './feedback.js';

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
  if (hash !== '#/seance' && voice.active) voice.stop();
  if (hash === '#/seance') {
    if (!store.active) return go('#/');
    if (voicePref() && !voice.active) voice.start();
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
      <h1>Swish</h1>
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
        : `<p class="muted intro">Lance ta première séance : après chaque tir, tape <b>Marqué</b> ou <b>Raté</b>, ou active la <b>voix</b> et dis-le simplement. L'app calcule ton pourcentage et suit ta progression.</p>`
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
        ${
          hasMic
            ? `<button class="ghost mic ${voice.active ? 'on' : ''}" data-action="voice" aria-pressed="${voice.active}">
                ${voice.active ? '🎙 Voix activée' : '🎙 Voix'}
              </button>`
            : ''
        }
        <button class="ghost" data-action="end">Terminer</button>
      </header>
      ${voice.active || voiceStatus === 'error' ? voiceBanner() : ''}

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

function shot(made, byVoice = false) {
  // Anti double-tap : ignore un 2e appui dans les 300 ms (pas pour la voix : « raté raté » = 2 tirs).
  const now = Date.now();
  if (!byVoice && now - lastTap < 300) return;
  lastTap = now;
  store.addShot(made);
  navigator.vibrate?.(made ? 40 : [25, 60, 25]);
  if (voice.active) {
    beep[made ? 'make' : 'miss']();
    announceEvery10();
  }
  renderSession();
  app.querySelector(made ? '.make' : '.miss')?.classList.add('flash');
}

function undoShot() {
  store.undo();
  if (voice.active) beep.undo();
  renderSession();
}

// Tous les 10 tirs, l'app annonce le score à voix haute (micro coupé pendant ce temps).
function announceEvery10() {
  const r = summarize(store.active.shots);
  if (r.attempts % 10 !== 0) return;
  voice.mute(10000);
  announce(`${r.made} sur ${r.attempts}, ${r.pct} pour cent`, () => voice.mute(600));
}

// ---------- Commande vocale ----------
// Deux moteurs : « hors ligne » (sur le téléphone, accepte le micro des écouteurs)
// et « google » (celui de Chrome : micro du téléphone uniquement, réseau obligatoire).

const VOICE_KEY = 'swish:voice';
const ENGINE_KEY = 'swish:engine';
const MIC_KEY = 'swish:mic';
const voicePref = () => localStorage.getItem(VOICE_KEY) === '1';
const hasMic = Boolean(navigator.mediaDevices?.getUserMedia);

let voiceStatus = 'off';
let voiceDetail = '';
let lastHeard = '';
let mics = [];
let engineName = localStorage.getItem(ENGINE_KEY) || 'offline';
if (engineName === 'google' && !voiceSupported) engineName = 'offline';

const handlers = {
  onCommand(cmd) {
    if (!store.active) return;
    if (cmd === 'undo') undoShot();
    else shot(cmd === 'make', true);
  },
  onStatus(status, detail = '') {
    voiceStatus = status;
    voiceDetail = detail;
    if (status === 'listening') refreshMics();
    else if (location.hash === '#/seance' && store.active) renderSession();
  },
  onHeard(text) {
    lastHeard = text.trim();
    const el = app.querySelector('[data-heard]');
    if (el) el.textContent = `Entendu : « ${lastHeard} »`;
  },
};

const engines = {
  offline: createOfflineVoice({ ...handlers, getMicId: () => localStorage.getItem(MIC_KEY) || '' }),
  google: voiceSupported ? createVoice(handlers) : null,
};

// Façade : le reste de l'app parle à « voice » sans savoir quel moteur tourne.
const voice = {
  get active() {
    return engines[engineName].active;
  },
  start: () => engines[engineName].start(),
  stop: () => engines[engineName].stop(),
  mute: (ms) => engines[engineName].mute(ms),
};

// Les noms des micros ne sont connus qu'une fois le micro autorisé.
async function refreshMics() {
  try {
    mics = await listMics();
  } catch {
    mics = [];
  }
  // Première fois : on choisit tout seul les écouteurs s'ils sont connectés.
  if (engineName === 'offline' && localStorage.getItem(MIC_KEY) === null) {
    const headset = guessHeadset(mics);
    localStorage.setItem(MIC_KEY, headset);
    if (headset) engines.offline.restart();
  }
  if (location.hash === '#/seance' && store.active) renderSession();
}
navigator.mediaDevices?.addEventListener?.('devicechange', () => voice.active && refreshMics());

function voiceBanner() {
  const micId = localStorage.getItem(MIC_KEY) || '';
  const settings = `
    <div class="voice-settings">
      <label>Moteur
        <select data-setting="engine">
          <option value="offline" ${engineName === 'offline' ? 'selected' : ''}>Sur le téléphone (écouteurs OK)</option>
          ${voiceSupported ? `<option value="google" ${engineName === 'google' ? 'selected' : ''}>Google (micro du téléphone)</option>` : ''}
        </select>
      </label>
      ${
        engineName === 'offline'
          ? `<label>Micro
        <select data-setting="mic">
          <option value="">Micro par défaut</option>
          ${mics.map((m) => `<option value="${m.deviceId}" ${m.deviceId === micId ? 'selected' : ''}>${m.label || 'Micro'}</option>`).join('')}
        </select>
      </label>`
          : ''
      }
    </div>`;

  if (voiceStatus === 'error') return `<div class="voice-banner error"><p>${voiceDetail}</p>${settings}</div>`;
  if (voiceStatus === 'loading') return `<div class="voice-banner"><p><span class="dot"></span> ${voiceDetail}</p></div>`;
  return `<div class="voice-banner">
      <p><span class="dot ${voiceStatus === 'listening' ? 'live' : ''}"></span>
      Dis <b>« marqué »</b> ou <b>« raté »</b> · <b>« annule »</b> pour corriger</p>
      <p class="heard muted" data-heard>${lastHeard ? `Entendu : « ${lastHeard} »` : ''}</p>
      ${settings}
    </div>`;
}

function toggleVoice() {
  unlockAudio();
  if (voice.active) {
    voice.stop();
    localStorage.setItem(VOICE_KEY, '0');
  } else {
    voiceStatus = 'off';
    voice.start();
    localStorage.setItem(VOICE_KEY, '1');
  }
  renderSession();
}

function changeVoiceSetting(name, value) {
  if (name === 'engine') {
    const wasActive = voice.active;
    if (wasActive) voice.stop();
    engineName = value;
    localStorage.setItem(ENGINE_KEY, value);
    voiceStatus = 'off';
    if (wasActive || voicePref()) voice.start();
  } else if (name === 'mic') {
    localStorage.setItem(MIC_KEY, value);
    lastHeard = '';
    engines.offline.restart();
  }
  renderSession();
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
      unlockAudio();
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
      undoShot();
      break;
    case 'voice':
      toggleVoice();
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
  if (e.target.dataset.setting) return changeVoiceSetting(e.target.dataset.setting, e.target.value);
  if (e.target.dataset.action !== 'import' || !e.target.files[0]) return;
  try {
    const n = store.importJSON(await e.target.files[0].text());
    alert(`${n} séance${n > 1 ? 's' : ''} importée${n > 1 ? 's' : ''}.`);
  } catch {
    alert("Ce fichier n'est pas une sauvegarde Swish valide.");
  }
  route();
});

async function exportData() {
  const name = `swish-${new Date().toISOString().slice(0, 10)}.json`;
  const file = new File([store.exportJSON()], name, { type: 'application/json' });
  // Sur Android : feuille de partage (Drive, mail…). Sinon : téléchargement.
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Sauvegarde Swish' });
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
