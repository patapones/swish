// Commande vocale : écoute en continu et transforme des mots-clés en tirs.
// Utilise la reconnaissance vocale de Chrome (Web Speech API), qui a besoin du réseau.

// La reconnaissance écrit souvent le mot autrement (« raté » → « rater », « ratée »…),
// d'où les variantes. Tout est comparé sans accents ni majuscules.
const WORDS = {
  make: ['marque', 'marquer', 'marquee', 'marques', 'marquees', 'marquez', 'dedans', 'panier', 'swish', 'bingo'],
  miss: ['rate', 'rater', 'ratee', 'rates', 'ratees', 'ratez', 'dehors', 'loupe', 'louper', 'manque', 'manquer'],
  undo: ['annule', 'annuler', 'annulez', 'annulee'],
};

const LOOKUP = new Map(Object.entries(WORDS).flatMap(([cmd, words]) => words.map((w) => [w, cmd])));

const normalize = (text) =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z\s]/g, ' ');

// « raté raté marqué » → ['miss', 'miss', 'make']
export function parseCommands(text) {
  return normalize(text)
    .split(/\s+/)
    .map((w) => LOOKUP.get(w))
    .filter(Boolean);
}

const Recognition = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
export const voiceSupported = Boolean(Recognition);

// onCommand(cmd) pour chaque mot-clé ; onStatus(status, detail) pour l'affichage.
// status : 'listening' | 'off' | 'error'
export function createVoice({ onCommand, onStatus, onHeard }) {
  let rec = null;
  let wanted = false;
  let mutedUntil = 0;
  let blocked = false; // micro refusé : on garde le message d'erreur affiché

  function spawn() {
    const r = new Recognition();
    rec = r;
    let retryDelay = 300;
    r.lang = 'fr-FR';
    r.continuous = true;
    r.interimResults = false;
    r.maxAlternatives = 1;

    r.onstart = () => onStatus('listening');
    r.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (!e.results[i].isFinal) continue;
        const text = e.results[i][0].transcript;
        onHeard?.(text);
        if (Date.now() < mutedUntil) continue;
        parseCommands(text).forEach(onCommand);
      }
    };
    r.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        wanted = false;
        blocked = true;
        onStatus('error', 'Micro refusé : autorise-le dans les réglages du site.');
      } else if (e.error === 'network') {
        retryDelay = 3000;
        onStatus('error', 'Pas de réseau : la reconnaissance vocale en a besoin.');
      }
      // 'no-speech' / 'aborted' : rien à signaler, on relance dans onend.
    };
    // Chrome coupe l'écoute après un silence : on relance tant qu'elle est voulue.
    r.onend = () => {
      if (rec !== r) return; // ancienne instance (arrêt puis relance rapide)
      rec = null;
      if (wanted) setTimeout(() => wanted && !rec && spawn(), retryDelay);
      else if (!blocked) onStatus('off');
    };
    try {
      r.start();
    } catch {
      rec = null;
    }
  }

  return {
    start() {
      if (!voiceSupported || wanted) return;
      wanted = true;
      blocked = false;
      spawn();
    },
    stop() {
      wanted = false;
      rec?.abort();
      rec = null;
      onStatus('off');
    },
    // Ignore ce qui est entendu pendant que l'app parle elle-même.
    mute(ms) {
      mutedUntil = Date.now() + ms;
    },
    get active() {
      return wanted;
    },
  };
}
