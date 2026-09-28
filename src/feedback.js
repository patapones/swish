// Retour vocal quand on ne regarde pas l'écran (voix ou caméra).
// On passe par la synthèse vocale du téléphone : pendant que le micro écoute, Android envoie
// le son du navigateur vers l'écouteur d'appel (quasi inaudible), mais pas la synthèse vocale.

// Dit le texte ; onDone est appelé quand le téléphone a fini de parler (ou n'a pas pu).
export function say(text, onDone) {
  if (!('speechSynthesis' in window)) return onDone?.();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'fr-FR';
  u.rate = 1.15;
  u.onend = u.onerror = () => onDone?.();
  speechSynthesis.cancel(); // un nouveau tir remplace l'annonce précédente
  speechSynthesis.speak(u);
}
