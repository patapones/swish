// Stockage local (sur le téléphone uniquement). La séance en cours est sauvegardée
// à chaque tir, donc rien n'est perdu si le navigateur se ferme.

const KEY = 'swish:v1';

function empty() {
  return { version: 1, sessions: [], active: null };
}

function load() {
  try {
    const data = JSON.parse(localStorage.getItem(KEY));
    if (data && Array.isArray(data.sessions)) return data;
  } catch {
    // données illisibles : on repart de zéro plutôt que de planter
  }
  return empty();
}

let state = load();

function save() {
  localStorage.setItem(KEY, JSON.stringify(state));
}

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export const store = {
  get sessions() {
    return state.sessions;
  },
  get active() {
    return state.active;
  },
  getSession(id) {
    return state.sessions.find((s) => s.id === id);
  },

  startSession() {
    if (!state.active) {
      state.active = { id: uid(), startedAt: Date.now(), shots: [] };
      save();
    }
    return state.active;
  },
  addShot(made) {
    if (!state.active) return;
    state.active.shots.push({ m: made ? 1 : 0, t: Date.now() });
    save();
  },
  undo() {
    if (!state.active) return;
    state.active.shots.pop();
    save();
  },
  // Termine la séance. Une séance sans tir est simplement abandonnée.
  endSession() {
    const s = state.active;
    state.active = null;
    if (s && s.shots.length) {
      s.endedAt = s.shots[s.shots.length - 1].t;
      state.sessions.unshift(s);
    }
    save();
    return s && s.shots.length ? s : null;
  },
  deleteSession(id) {
    state.sessions = state.sessions.filter((s) => s.id !== id);
    save();
  },

  exportJSON() {
    return JSON.stringify({ version: 1, sessions: state.sessions }, null, 2);
  },
  // Fusionne une sauvegarde : les séances déjà présentes (même id) sont ignorées.
  importJSON(text) {
    const data = JSON.parse(text);
    if (!data || !Array.isArray(data.sessions)) throw new Error('Fichier invalide');
    const known = new Set(state.sessions.map((s) => s.id));
    const added = data.sessions.filter((s) => s.id && Array.isArray(s.shots) && !known.has(s.id));
    state.sessions = [...state.sessions, ...added].sort((a, b) => b.startedAt - a.startedAt);
    save();
    return added.length;
  },
};
