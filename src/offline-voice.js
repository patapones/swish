// Reconnaissance vocale sur le téléphone (Vosk, sans réseau).
// Contrairement à celle de Chrome, elle écoute le micro qu'on lui donne : celui des écouteurs Bluetooth compris.

import { parseCommands } from './voice.js';

const MODEL_URL = new URL('models/vosk-model-small-fr-0.22.tar.gz', document.baseURI).href;
const MODEL_CACHE = 'swish-models-v1';

// La reconnaissance ne choisit qu'entre ces mots. Avec seulement les commandes, elle force
// toute parole à en devenir une (« allez on continue » → « annule »). Les mots « leurres »
// absorbent ce qu'on dit d'autre sur le terrain ; ils ne déclenchent rien.
const COMMANDS = ['marqué', 'raté', 'annule', 'dedans', 'dehors'];
// Attention : pas de mots trop proches des commandes (« mal ouais » ≈ « marqué », « une » ≈ « annule »).
const DECOYS = [
  'allez', 'on', 'continue', 'encore', 'oh', 'non', 'oui', 'bien', 'bon', 'joué', 'vas-y', 'vas', 'y',
  'là', 'le', 'la', "c'est", 'pas', 'ça', 'presque', 'trop', 'court', 'long', 'zut', 'tir', 'et', 'yes',
  'dernier', 'série',
];
const GRAMMAR = JSON.stringify([...COMMANDS, ...DECOYS, '[unk]']);
// En dessous, on considère que c'était un bruit (rebond, vent…) et on ignore.
const MIN_CONFIDENCE = 0.6;

// Par ordre de préférence. « Headset earpiece » (Android) = l'écouteur d'appel du téléphone, pas un casque.
const HEADSET_PATTERNS = [/bluetooth/i, /jabra|buds|airpods|casque|[ée]couteur/i, /headset/i];
const NOT_HEADSET = /earpiece|speaker|built-in|default/i;

// Liste des micros disponibles (les noms n'apparaissent qu'après autorisation du micro).
export async function listMics() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === 'audioinput' && d.deviceId);
}

export function guessHeadset(mics) {
  for (const pattern of HEADSET_PATTERNS) {
    const mic = mics.find((m) => pattern.test(m.label) && !NOT_HEADSET.test(m.label));
    if (mic) return mic.deviceId;
  }
  return '';
}

// Télécharge le modèle une seule fois (mis en cache), avec la progression.
async function fetchModel(onProgress) {
  const cache = await caches.open(MODEL_CACHE);
  let res = await cache.match(MODEL_URL);
  if (!res) {
    const net = await fetch(MODEL_URL);
    if (!net.ok) throw new Error('Téléchargement du modèle impossible');
    const total = +net.headers.get('content-length') || 42_000_000;
    const reader = net.body.getReader();
    const chunks = [];
    let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.length;
      onProgress(Math.min(99, Math.round((loaded / total) * 100)));
    }
    await cache.put(MODEL_URL, new Response(new Blob(chunks), { headers: { 'content-type': 'application/gzip' } }));
    res = await cache.match(MODEL_URL);
  }
  return URL.createObjectURL(await res.blob());
}

let modelPromise = null;

function loadModel(onProgress) {
  modelPromise ??= (async () => {
    const [{ createModel }, blobUrl] = await Promise.all([import('vosk-browser'), fetchModel(onProgress)]);
    return createModel(blobUrl);
  })().catch((err) => {
    modelPromise = null; // on pourra réessayer
    throw err;
  });
  return modelPromise;
}

export function isModelCached() {
  return caches.open(MODEL_CACHE).then((c) => c.match(MODEL_URL)).then(Boolean, () => false);
}

// Même interface que la reconnaissance Chrome : start / stop / mute / active.
export function createOfflineVoice({ onCommand, onStatus, onHeard, getMicId }) {
  let wanted = false;
  let mutedUntil = 0;
  let stream = null;
  let ctx = null;
  let recognizer = null;

  function teardown() {
    recognizer?.remove();
    recognizer = null;
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    ctx?.close();
    ctx = null;
  }

  async function run() {
    onStatus('loading', 'Préparation de la reconnaissance vocale…');
    const model = await loadModel((p) => onStatus('loading', `Téléchargement du modèle vocal : ${p} % (une seule fois)`));
    if (!wanted) return;

    const micId = getMicId();
    const audio = {
      echoCancellation: true, // évite que le micro entende les bips de l'app
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1,
    };
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: micId ? { ...audio, deviceId: { exact: micId } } : audio,
      });
    } catch (err) {
      // Micro choisi absent (écouteurs pas connectés) : on prend celui du téléphone.
      if (!micId || !['OverconstrainedError', 'NotFoundError', 'NotReadableError'].includes(err.name)) throw err;
      stream = await navigator.mediaDevices.getUserMedia({ audio });
    }
    if (!wanted) return teardown();

    ctx = new AudioContext();
    recognizer = new model.KaldiRecognizer(ctx.sampleRate, GRAMMAR);
    recognizer.setWords(true);
    recognizer.on('result', (msg) => {
      const words = msg.result.result ?? [];
      if (!words.length) return;
      const heard = words.filter((w) => w.word !== '[unk]' && w.conf >= MIN_CONFIDENCE).map((w) => w.word);
      onHeard?.(heard.length ? heard.join(' ') : '(bruit ignoré)');
      parseCommands(heard.join(' ')).forEach(onCommand);
    });

    const source = ctx.createMediaStreamSource(stream);
    const processor = ctx.createScriptProcessor(4096, 1, 1);
    processor.onaudioprocess = (e) => {
      if (!recognizer) return;
      // Pendant que l'app parle, la reconnaissance reçoit du silence : elle n'entend jamais
      // « Marqué » dit par le téléphone, même si son résultat arrive un peu plus tard.
      if (Date.now() < mutedUntil) recognizer.acceptWaveformFloat(new Float32Array(e.inputBuffer.length), ctx.sampleRate);
      else recognizer.acceptWaveform(e.inputBuffer);
    };
    source.connect(processor).connect(ctx.destination);

    const track = stream.getAudioTracks()[0];
    // Si les écouteurs se déconnectent, on repart sur le micro par défaut.
    track.onended = () => {
      if (!wanted) return;
      teardown();
      start();
    };
    onStatus('listening', track.label);
  }

  function start() {
    run().catch((err) => {
      teardown();
      wanted = false;
      const denied = err?.name === 'NotAllowedError';
      onStatus(
        'error',
        denied ? 'Micro refusé : autorise-le dans les réglages du site.' : `Reconnaissance vocale indisponible (${err?.message ?? err}).`,
      );
    });
  }

  return {
    start() {
      if (wanted) return;
      wanted = true;
      start();
    },
    stop() {
      wanted = false;
      teardown();
      onStatus('off');
    },
    // Change de micro à chaud.
    restart() {
      if (!wanted) return;
      teardown();
      start();
    },
    // Coupe l'écoute pendant ms (l'app parle).
    mute(ms) {
      mutedUntil = Date.now() + ms;
    },
    get active() {
      return wanted;
    },
  };
}
