# Dinner Burger — PWA

## Fichiers
- `index.html` — l'application (mode client + mode gérant)
- `manifest.json` — métadonnées PWA (nom, icônes, couleurs)
- `sw.js` — service worker (mode hors ligne)
- `icon-192.png`, `icon-512.png` — icônes de l'app

## Déployer sur GitHub Pages

1. **Crée un dépôt** sur github.com (ex : `dinner-burger-app`), public.
2. **Ajoute ces 5 fichiers** à la racine du dépôt :
   - Sur github.com → bouton "Add file" → "Upload files" → glisse les 5 fichiers → "Commit changes".
3. **Active GitHub Pages** :
   - Va dans **Settings** du dépôt → **Pages** (menu de gauche).
   - Sous "Build and deployment" → Source : **Deploy from a branch**.
   - Branch : **main**, dossier : **/ (root)** → **Save**.
4. **Attends 1-2 minutes**, puis ton app sera en ligne à :
   ```
   https://TON-PSEUDO.github.io/dinner-burger-app/
   ```

## Les deux modes

- **Mode gérant** (par défaut) :
  `https://TON-PSEUDO.github.io/dinner-burger-app/`
- **Mode client** (à partager avec tes clients) :
  `https://TON-PSEUDO.github.io/dinner-burger-app/?mode=client`

Le lien client est aussi généré automatiquement dans l'app, onglet **Config**.

## Installer la PWA sur le téléphone

- **Android (Chrome)** : ouvre le lien → une bannière "Installer" apparaît en haut, ou menu ⋮ → "Ajouter à l'écran d'accueil".
- **iPhone (Safari)** : ouvre le lien → bouton Partager (carré avec flèche) → "Sur l'écran d'accueil".

## Mettre ton propre logo

Oui, facile ! Deux fichiers à remplacer :

1. Prépare ton logo en PNG, carré, fond compris (pas de transparence si possible pour l'icône d'installation).
2. Exporte-le en **192x192 px** et **512x512 px**.
3. Renomme-les exactement `icon-192.png` et `icon-512.png`.
4. Sur GitHub, upload ces 2 fichiers à la racine du dépôt → ils remplaceront automatiquement les anciens (même nom = écrasement).

C'est tout : c'est ce qui apparaît comme icône quand quelqu'un installe l'app sur son téléphone.

## Notes importantes

- Les données (commandes, stock, clients...) sont stockées **localement dans le navigateur** (`localStorage`). Elles ne sont donc **pas partagées** entre le téléphone du gérant et ceux des clients — chaque appareil a sa propre copie.
- Pour que les commandes remontent réellement au gérant, le circuit actuel passe par **WhatsApp** (bouton "Commander par WhatsApp") ou par **QR code scanné en caisse**.
- Si tu modifies `index.html` plus tard, pense à changer `CACHE_NAME` dans `sw.js` (ex : `dinner-burger-v2`) pour forcer la mise à jour du cache chez les utilisateurs.