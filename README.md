# Dinner Burger — PWA (Supabase)

Application client + gérant pour Dinner Burger (Goma).  
**Toutes les données sont dans Supabase** (plus de localStorage).  
Les clients peuvent créer un compte pour retrouver l’historique de leurs commandes.

## Fichiers

| Fichier | Rôle |
|---------|------|
| `index.html` | App (mode client + mode gérant) |
| `script.js` | Logique + connexion Supabase |
| `style.css` | Styles |
| `sw.js` | Service worker (hors ligne) |
| `manifest.json` | Métadonnées PWA |
| `supabase-schema.sql` | Schéma SQL à exécuter une fois |
| `supabase-security-fix.sql` | **Correctif de sécurité RLS — à exécuter juste après le schéma** |
| `tests/admin-access.test.js` | Tests du contrôle d'accès gérant (`node tests/admin-access.test.js`) |
| `icon-192.png` / `icon-512.png` | Icônes (à ajouter) |

## 1. Créer le projet Supabase

1. Va sur [https://supabase.com](https://supabase.com) → **New project**.
2. Choisis un nom, un mot de passe DB, une région proche (Europe).
3. Attends 1–2 min que le projet soit prêt.

## 2. Exécuter le schéma SQL

1. Menu gauche → **SQL Editor** → **New query**.
2. Colle **tout le contenu** de `supabase-schema.sql`.
3. Clique **Run**.

Cela crée les tables, les politiques de sécurité (RLS), le menu de départ et le stock initial.

### 2 bis. Exécuter le correctif de sécurité (obligatoire)

1. **SQL Editor** → **New query**.
2. Colle **tout le contenu** de `supabase-security-fix.sql`.
3. Clique **Run**.

Ce fichier ajoute les triggers qui empêchent l'élévation de privilèges, recalculent
les montants côté serveur et limitent le flood. Il est idempotent : tu peux le
relancer sans risque, y compris sur une base déjà en production.

## 3. Activer le temps réel

1. Menu gauche → **Database** → **Replication** (ou **Publications**).
2. Active la table `orders_incoming` (toggle ON).

## 4. Créer le compte gérant (admin)

1. **Authentication** → **Users** → **Add user** → **Create new user**.
2. Mets **ton email** + un mot de passe solide.
3. Coche **Auto Confirm User** si disponible.
4. Ensuite, dans **SQL Editor**, exécute (remplace l’email) :

```sql
update profiles
set role = 'admin'
where id = (
  select id from auth.users where email = 'TON-EMAIL@example.com'
);
```

Sans cette étape, le compte reste « client » et ne pourra pas gérer le restaurant.

## 5. Récupérer les clés API

1. **Project Settings** → **API**.
2. Copie :
   - **Project URL**
   - **anon public** (jamais la `service_role`)

## 6. Brancher l’app

Ouvre `script.js`, tout en haut :

```js
var supabaseConfig = {
  url: "https://xxxx.supabase.co",
  anonKey: "eyJhbGciOi..."
};
```

## 7. Déployer sur GitHub Pages

1. Crée un dépôt public (ex. `dinner-burger-app`).
2. Upload tous les fichiers à la racine (dont `index.html`, pas `index-2.html`).
3. **Settings** → **Pages** → Source : branch `main`, dossier `/ (root)`.
4. Attends 1–2 min. L’app est en ligne :

```
https://TON-PSEUDO.github.io/dinner-burger-app/
```

### Les deux modes

- **Gérant** : `https://TON-PSEUDO.github.io/dinner-burger-app/`
- **Client** : `https://TON-PSEUDO.github.io/dinner-burger-app/?mode=client`

Le lien client est aussi généré dans l’onglet **Config** du gérant.

## Comptes clients

Côté client (`?mode=client`), onglet **Suivi** :

1. **Créer un compte** (nom, téléphone, email, mot de passe).
2. Se connecter.
3. L’historique des commandes passées (WhatsApp / QR) apparaît automatiquement.
4. Les champs nom / téléphone du panier sont préremplis.

Les clients **non connectés** peuvent toujours commander (guest) via WhatsApp ou QR.

## Sécurité (résumé)

| Qui | Peut |
|-----|------|
| Anonyme | Lire le menu, envoyer une commande entrante (`orders_incoming`, débit limité) |
| Client connecté | Idem + créer **sa** fiche client, passer **ses** commandes, voir **ses** commandes |
| Admin | Tout (menu, stock, finance, commandes, config…) |

- La clé `anon` est publique par design — c’est normal.
- Ce qui protège les données, ce sont les **politiques RLS** du SQL.
- Ne mets **jamais** la clé `service_role` dans le front.

### Règles appliquées côté serveur

- **Le rôle n'est jamais fourni par le navigateur.** À l'inscription il est forcé à
  `client`, et un trigger empêche un utilisateur de modifier son propre `role`.
  Seul un admin existant (ou le SQL Editor) peut promouvoir quelqu'un.
- **`anon` n'écrit plus dans `orders` ni `clients`.** Les commandes des visiteurs
  non connectés passent uniquement par `orders_incoming`.
- **Un client ne peut écrire que pour lui-même** (`user_id = auth.uid()`), et sa
  commande est automatiquement rattachée à sa propre fiche client.
- **`total`, `cost` et `profit` sont recalculés depuis la table `products`** pour
  toute commande client : impossible de commander à 0 FC ou de fausser les marges.
  Le gérant garde la saisie libre en caisse (remise, prix négocié).
- **`orders_count` / `total` de la fiche client** sont mis à jour par le serveur,
  plus par le navigateur.
- **`orders_incoming`** : payload borné à 8 Ko, 30 commandes/minute au total,
  5/minute par compte.

### Accès gérant hors ligne

L'ancienne version accordait les droits gérant dès qu'une clé `localStorage`
existait : n'importe qui pouvait la créer depuis la console et ouvrir le tableau
de bord (chiffre d'affaires, marges, fichier clients). Désormais :

- les droits hors ligne exigent une **session Supabase présente sur l'appareil**
  (JWT signé par le serveur) dont l'utilisateur correspond au cache admin ;
- ce cache **expire au bout de 7 jours** sans reconnexion ;
- les données financières ne sont **mises en cache que si ces droits sont établis**,
  et sont **purgées** à la déconnexion ou si la vérification échoue ;
- bloquer le CDN Supabase ne donne plus les droits gérant (le mode 100 % local
  n'est reconnu que si aucun projet Supabase n'est configuré dans `script.js`).

Ces règles sont couvertes par des tests : `node tests/admin-access.test.js`.

### Reste à faire (non couvert par ce correctif)

- `products.cost` est lisible publiquement (la table est en `select using (true)`) :
  tes marges d'achat sont visibles. À déplacer derrière une vue publique sans `cost`.
- `ambassadors` et `config` sont également en lecture publique (commissions,
  objectifs de CA, téléphones).
- Quelques `innerHTML` affichent encore des champs non échappés (`category`,
  `desc`, `notes`).

## Icônes PWA

Ajoute à la racine du dépôt :

- `icon-192.png` (192×192)
- `icon-512.png` (512×512)

Sans elles, l’installation sur le téléphone fonctionne moins bien.

## Mettre à jour le cache

Si tu modifies le code, change `CACHE_NAME` dans `sw.js` (ex. `dinner-burger-v4`) pour forcer le rafraîchissement chez les utilisateurs.

## Notes

- Plus de `localStorage` pour les données métier : tout est dans Supabase.
- Le gérant doit être **connecté** (compte admin) pour voir les commandes en direct et piloter le resto.
- Les photos produits sont stockées en base64 dans la table `products` (ok pour de petites images ; pour du volume, passer à Supabase Storage plus tard).


## Photos produits (Supabase Storage)

Par défaut, hors ligne, les photos sont en cache local (base64 compressé).

Pour le cloud, exécute aussi `supabase-storage.sql` (crée le bucket public `product-photos`).
Ensuite les nouvelles photos uploadées en ligne stockent une **URL** dans `products.photo`, pas le fichier entier.
