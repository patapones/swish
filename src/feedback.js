// Retour sonore pour la commande vocale : on sait que le tir est noté sans regarder l'écran.
// Des bips plutôt que des mots, pour que le micro ne se réentende pas.

let ctx = null;

// À appeler pendant un geste de l'utilisateur (toucher), sinon le navigateur bloque le son.
export function unlockAudio() {
  ctx ??= new AudioContext();
  if (ctx.state === 'suspended') ctx.resume();
}

function tone(freq, start, duration) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const t = ctx.currentTime + start;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.5, t + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + duration);
}

export const beep = {
  make: () => ctx && (tone(660, 0, 0.12), tone(990, 0.12, 0.18)), // montant
  miss: () => ctx && tone(220, 0, 0.3), // grave
  undo: () => ctx && (tone(440, 0, 0.08), tone(440, 0.12, 0.08)), // double neutre
};

// Annonce vocale du score. onDone est appelé quand l'app a fini de parler.
export function announce(text, onDone) {
  if (!('speechSynthesis' in window)) return onDone?.();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'fr-FR';
  u.onend = u.onerror = () => onDone?.();
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}
