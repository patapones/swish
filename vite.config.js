import { defineConfig } from 'vite';

// base relative: l'app marche aussi bien à la racine qu'en sous-dossier (GitHub Pages).
export default defineConfig({
  base: './',
  // Le moteur vocal hors ligne (vosk) pèse ~6 Mo ; il n'est chargé qu'à l'activation de la voix.
  build: { chunkSizeWarningLimit: 7000 },
});
