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
| Anonyme | Lire le menu, créer une commande entrante, créer une fiche client |
| Client connecté | Idem + voir ses propres commandes |
| Admin | Tout (menu, stock, finance, commandes, config…) |

- La clé `anon` est publique par design — c’est normal.
- Ce qui protège les données, ce sont les **politiques RLS** du SQL.
- Ne mets **jamais** la clé `service_role` dans le front.

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
