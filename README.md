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

## Activer les commandes en direct (Supabase)

Sans cette etape, l'app fonctionne exactement comme avant (WhatsApp + QR). Avec Supabase en plus, la commande d'un client apparait **instantanement** dans l'onglet "Cmd" du gerant, sans qu'il ait besoin de scanner quoi que ce soit.

1. Va sur https://supabase.com, cree un compte gratuit, puis **New project**.
2. Choisis un nom, un mot de passe (garde-le, tu n'en auras pas besoin ici mais Supabase le demande), et une region proche (Europe par exemple).
3. Attends 1-2 minutes que le projet soit pret.
4. Dans le menu de gauche → **SQL Editor** → **New query**, colle ceci puis **Run** :
   ```sql
   create extension if not exists pgcrypto;

   create table orders_incoming (
     id uuid primary key default gen_random_uuid(),
     created_at timestamptz default now(),
     payload jsonb not null,
     status text not null default 'nouvelle'
   );

   alter table orders_incoming enable row level security;

   -- Les clients peuvent CREER une commande, sans compte
   create policy "Clients can insert orders" on orders_incoming
     for insert to anon with check (true);

   -- Seul un compte connecte (toi) peut LIRE les commandes
   create policy "Only logged-in admin can read orders" on orders_incoming
     for select to authenticated using (true);

   -- Seul un compte connecte (toi) peut MODIFIER le statut
   create policy "Only logged-in admin can update orders" on orders_incoming
     for update to authenticated using (true) with check (true);
   ```
5. Dans le menu de gauche → **Database** → **Replication**, trouve la table `orders_incoming` et **active-la** (toggle ON) pour le temps reel.
6. Dans le menu de gauche → **Authentication** → **Users** → **Add user** → **Create new user**. Mets TON email et un mot de passe solide (ne coche pas "Auto Confirm User" si l'option n'existe plus, sinon coche-la pour eviter l'email de confirmation). C'est CE compte que tu utiliseras pour te connecter dans l'app, personne d'autre n'y aura acces.
7. Dans le menu de gauche → **Project Settings** → **API**, copie le **Project URL** et la cle **anon public**. ⚠️ Ne copie jamais la cle **service_role** — elle donne un acces total et ne doit JAMAIS se retrouver dans du code visible publiquement.
8. Ouvre `script.js`, tout en haut, remplace les deux `"REMPLACE_MOI"` (`url` et `anonKey`) par tes vraies valeurs.
9. Recharge le site en mode gerant, onglet **Cmd** : une petite fenetre de connexion apparait. Connecte-toi avec l'email/mot de passe crees a l'etape 6. Une fois connecte, les commandes en direct s'affichent. Sur un autre appareil (ou navigateur en navigation privee) sans etre connecte, personne ne peut voir ces commandes.

**Securite en resume** :
- La cle `anonKey` est publique par design (visible dans le code) — ce n'est pas un probleme, c'est normal.
- Ce qui protege vraiment les donnees, ce sont les regles SQL ci-dessus : lecture/modification reservees a un compte connecte (toi), creation ouverte a tous (necessaire pour que les clients commandent sans compte).
- La cle `service_role` (a ne jamais utiliser ici) est la seule vraiment "secrete" — si un jour tu la vois dans Supabase, elle ne doit servir que sur un vrai serveur, jamais dans un site comme celui-ci.
- Reste un risque residuel : n'importe qui peut techniquement *creer* de fausses commandes (spam), puisque l'insertion est ouverte. Pas grave pour un usage normal — si ca arrive un jour, on pourra ajouter une protection supplementaire.

## Suivi de commande cote client (code a 4 chiffres)

Cette fonctionnalite demande **2 ajouts en base**, en plus de ce qui precede. Sans eux, l'onglet "Suivi" du client ne pourra pas verifier un code.

Dans **SQL Editor** → **New query**, colle ceci puis **Run** :
```sql
alter table orders_incoming add column if not exists code text;
create index if not exists idx_orders_incoming_code on orders_incoming(code);

-- Fonction securisee : permet a n'importe qui de VERIFIER le statut d'UNE commande
-- via son code a 4 chiffres, sans jamais pouvoir lister toutes les commandes.
create or replace function get_order_status(p_code text)
returns table(status text, order_type text, total numeric, created_at timestamptz)
language sql
security definer
set search_path = public
as $$
  select status, payload->>'orderType' as order_type,
         (payload->>'total')::numeric as total, created_at
  from orders_incoming
  where code = p_code
  order by created_at desc
  limit 1;
$$;

grant execute on function get_order_status(text) to anon;
```

**Comment ca marche** :
- Le client recoit un code a 4 chiffres (ex: `4827`) apres avoir valide sa commande, avec un petit QR qui contient juste ce code (beaucoup plus simple et fiable a scanner que l'ancien QR qui contenait toute la commande).
- Il est automatiquement redirige vers l'onglet **Suivi**, ou son statut se met a jour tout seul (verifie toutes les 8 secondes).
- Cote gerant, dans l'onglet **Cmd**, chaque commande recue affiche son code et un bouton qui avance le statut : `▶ Debuter preparation` → `✅ Marquer pret` → `🎉 Recuperee`. Des que tu passes une commande sur "pret", le client le voit apparaitre dans son Suivi.
- La fonction `get_order_status` est volontairement limitee : elle ne renvoie que le statut d'**une seule** commande a la fois (celle dont on connait deja le code), jamais la liste complete. Un code a 4 chiffres reste devinable en theorie (10 000 combinaisons), mais l'impact est minime : au pire, quelqu'un verrait juste "en preparation" / "pret" sans nom ni telephone.

## Notifications push (ntfy)

Une notification part sur ton telephone des qu'un client valide une commande, meme si ton app gerant est fermee.

1. Installe l'appli **ntfy** (Google Play / App Store).
2. Abonne-toi a un sujet secret (pas de nom devinable) — c'est deja fait pour toi, sujet actuel : `dinnerburgerjeanp_2008`.
3. Si tu veux changer de sujet, ouvre `script.js`, cherche `var ntfyTopic` et remplace la valeur — puis abonne-toi au nouveau sujet dans l'appli ntfy.

**A savoir** : c'est le navigateur du CLIENT qui envoie la notification (pas ton app), donc ca marche independamment de Supabase — meme si la synchro en direct echoue, la notif ntfy part quand meme. Le sujet ntfy n'est pas un secret absolu (n'importe qui connaissant le nom exact pourrait s'abonner et voir tes notifs) : garde-le juste assez peu devinable, comme c'est deja le cas.

## Notes importantes

- Les données (commandes, stock, clients...) sont stockées **localement dans le navigateur** (`localStorage`). Elles ne sont donc **pas partagées** entre le téléphone du gérant et ceux des clients — chaque appareil a sa propre copie.
- Pour que les commandes remontent réellement au gérant, le circuit actuel passe par **WhatsApp** (bouton "Commander par WhatsApp") ou par **QR code scanné en caisse**.
- Si tu modifies `index.html` plus tard, pense à changer `CACHE_NAME` dans `sw.js` (ex : `dinner-burger-v2`) pour forcer la mise à jour du cache chez les utilisateurs.
