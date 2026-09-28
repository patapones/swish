# Splash — compteur de tirs à 3 points

App web installable (PWA) pour compter ses tirs à l'entraînement et suivre son pourcentage.

## Phase 0 (actuelle) : compteur manuel
- Boutons **Marqué** / **Raté**, pourcentage en direct, séries, annulation du dernier tir
- Écran maintenu allumé pendant la séance, vibration à chaque tir
- Historique, détail par tranche de 10 tirs, courbe de progression
- Données stockées sur le téléphone ; export/import JSON pour sauvegarder
- Fonctionne hors ligne une fois ouverte

## Développement
```bash
npm install
npm run dev     # http://localhost:5173 (et sur le réseau local)
npm test
npm run build
```

## Structure
- `src/stats.js` — calculs (pourcentage, séries, tranches), testés dans `stats.test.js`
- `src/store.js` — stockage local des séances
- `src/main.js` — écrans (accueil, séance, détail) et actions
- `src/chart.js` — courbe de progression
- `public/` — manifest, service worker, icônes

## Déploiement
Chaque push sur `main` publie l'app sur GitHub Pages (`.github/workflows/deploy.yml`).
Dans le dépôt GitHub : **Settings → Pages → Source : GitHub Actions**.
