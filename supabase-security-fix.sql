-- ============================================================================
-- Dinner Burger - CORRECTIF DE SECURITE (RLS + controle admin)
--
-- A executer UNE FOIS : Supabase -> SQL Editor -> New query -> coller -> Run.
-- Le script est idempotent : tu peux le relancer sans risque.
--
-- Ce qu'il corrige :
--   1. ELEVATION DE PRIVILEGES (critique) : n'importe qui pouvait devenir admin
--      a l'inscription, ou en modifiant son propre profil.
--   2. INSERTIONS ANONYMES : anon pouvait creer des lignes dans orders/clients,
--      et un client authentifie pouvait ecrire au nom d'un autre utilisateur.
--   3. CHIFFRES FALSIFIABLES : total / cost / profit venaient du navigateur.
--      Ils sont desormais recalcules cote serveur depuis la table products.
--   4. TABLE orders_incoming : insertion libre sans aucune limite (flood).
-- ============================================================================


-- ============================================================================
-- 1) ELEVATION DE PRIVILEGES
-- ============================================================================

-- 1.a  L'ancien trigger d'inscription faisait confiance a
--      raw_user_meta_data->>'role', qui est envoye par le navigateur.
--      Un simple signUp({ options: { data: { role: 'admin' } } }) suffisait
--      pour obtenir un compte gerant. Le role est maintenant force a 'client' :
--      seule une promotion explicite par un admin (ou via SQL Editor) le change.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  insert into public.profiles (id, role, name)
  values (
    new.id,
    'client',
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$fn$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();


-- 1.b  La politique "Users can update own profile" autorisait un client a
--      passer son propre role a 'admin'. RLS ne sait pas proteger UNE colonne,
--      donc on la protege avec un trigger.
--      auth.uid() is null = appel via SQL Editor / service_role : autorise,
--      c'est ainsi que tu promeus le premier admin (voir README, etape 4).
create or replace function protect_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if auth.uid() is not null and not is_admin() then
    new.role := old.role;
  end if;
  return new;
end;
$fn$;

drop trigger if exists protect_profile_role_trg on profiles;
create trigger protect_profile_role_trg
  before update on profiles
  for each row execute function protect_profile_role();


-- ============================================================================
-- 2) INSERTIONS : plus rien d'anonyme, et chacun chez soi
-- ============================================================================

-- 2.a  orders : anon n'a aucune raison d'ecrire ici (les commandes anonymes
--      passent par orders_incoming). Un client authentifie ne peut inserer
--      qu'une commande qui lui appartient.
drop policy if exists "Anon insert orders" on orders;
drop policy if exists "Authenticated insert orders" on orders;
drop policy if exists "Client inserts own order" on orders;
create policy "Client inserts own order" on orders
  for insert to authenticated
  with check (user_id = auth.uid());

-- 2.b  clients : idem, la fiche client doit etre rattachee a son propre compte.
drop policy if exists "Anon can insert client" on clients;
drop policy if exists "Authenticated can insert client" on clients;
drop policy if exists "Client inserts own row" on clients;
create policy "Client inserts own row" on clients
  for insert to authenticated
  with check (user_id = auth.uid());

-- 2.c  clients : un client pouvait modifier sa propre fiche, donc aussi
--      orders_count, total, ambassador... Ces colonnes sont maintenant
--      pilotees uniquement par le serveur ou par le gerant.
create or replace function protect_client_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  -- Laisse passer les mises a jour declenchees par le serveur lui-meme
  -- (trigger sync_client_totals), sinon elles seraient annulees ici.
  if coalesce(current_setting('app.server_sync', true), 'off') = 'on' then
    return new;
  end if;

  if auth.uid() is not null and not is_admin() then
    new.user_id     := old.user_id;
    new.orders_count := old.orders_count;
    new.total       := old.total;
    new.ambassador  := old.ambassador;
    new.first_order := old.first_order;
    new.last_order  := old.last_order;
  end if;
  return new;
end;
$fn$;

drop trigger if exists protect_client_columns_trg on clients;
create trigger protect_client_columns_trg
  before update on clients
  for each row execute function protect_client_columns();


-- ============================================================================
-- 3) INTEGRITE DES COMMANDES : les prix ne viennent plus du navigateur
-- ============================================================================

-- Pour toute commande inseree par un client (pas le gerant, pas le SQL Editor) :
--   - user_id force a auth.uid()
--   - total / cost / profit recalcules depuis la table products
--   - status / payment forces (un client ne valide pas sa propre commande)
-- Le gerant garde la main : en caisse, il saisit des montants libres
-- (remise, arrangement, prix negocie) et le trigger ne touche a rien.
create or replace function enforce_order_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  item            jsonb;
  raw_id          text;
  qty             numeric;
  prod            products;
  computed_total  numeric := 0;
  computed_cost   numeric := 0;
  nb_items        int;
  own_client_id   uuid;
begin
  -- service_role / SQL Editor / gerant : on ne modifie rien
  if auth.uid() is null or is_admin() then
    return new;
  end if;

  new.user_id := auth.uid();

  -- Une commande client est forcement rattachee a SA fiche client :
  -- sinon il pourrait gonfler le compteur de quelqu'un d'autre.
  select id into own_client_id from clients where user_id = auth.uid() limit 1;
  new.client_id := own_client_id;

  -- Bornes sur les champs libres (limite le stockage et la surface XSS)
  new.client_name := left(coalesce(new.client_name, ''), 80);
  new.address     := left(coalesce(new.address, ''), 200);
  new.notes       := left(coalesce(new.notes, ''), 300);
  new.ambassador  := left(coalesce(new.ambassador, ''), 20);

  nb_items := jsonb_array_length(coalesce(new.items, '[]'::jsonb));
  if nb_items = 0 then
    raise exception 'Commande vide';
  end if;
  if nb_items > 50 then
    raise exception 'Trop de lignes dans la commande';
  end if;

  for item in
    select jae.value from jsonb_array_elements(new.items) as jae
  loop
    raw_id := item->>'id';
    if raw_id is null or raw_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Identifiant produit invalide dans la commande';
    end if;

    qty := floor(coalesce(nullif(item->>'qty', '')::numeric, 1));
    if qty < 1 or qty > 100 then
      raise exception 'Quantite invalide dans la commande';
    end if;

    select * into prod from products where id = raw_id::uuid and available;
    if not found then
      raise exception 'Produit indisponible ou inconnu dans la commande';
    end if;

    computed_total := computed_total + prod.price * qty;
    computed_cost  := computed_cost  + prod.cost  * qty;
  end loop;

  new.total         := computed_total;
  new.cost          := computed_cost;
  new.profit        := computed_total - computed_cost;
  new.status        := 'en_attente';
  new.payment       := 'pending';
  new.is_new_client := false;
  return new;
end;
$fn$;

drop trigger if exists enforce_order_integrity_trg on orders;
create trigger enforce_order_integrity_trg
  before insert on orders
  for each row execute function enforce_order_integrity();


-- Un client ne doit pas pouvoir modifier sa commande apres coup.
-- (Aucune politique UPDATE ne l'autorisait, on garde la table verrouillee :
--  seule la politique "Admin full orders" permet un update.)
drop policy if exists "Client updates own orders" on orders;


-- Les compteurs de la fiche client sont mis a jour cote serveur, plus depuis
-- le navigateur. Ne s'applique qu'aux commandes clients : les commandes
-- saisies par le gerant continuent d'etre agregees par l'application.
create or replace function sync_client_totals()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if auth.uid() is null or is_admin() then
    return new;
  end if;
  if new.client_id is null then
    return new;
  end if;

  perform set_config('app.server_sync', 'on', true);

  update clients set
    orders_count = coalesce(orders_count, 0) + 1,
    total        = coalesce(total, 0) + coalesce(new.total, 0),
    first_order  = coalesce(first_order, new.created_at),
    last_order   = new.created_at
  where id = new.client_id;

  perform set_config('app.server_sync', 'off', true);

  return new;
end;
$fn$;

drop trigger if exists sync_client_totals_trg on orders;
create trigger sync_client_totals_trg
  after insert on orders
  for each row execute function sync_client_totals();


-- ============================================================================
-- 4) orders_incoming : garder l'ouverture aux anonymes, sans laisser la porte
--    grande ouverte
-- ============================================================================

drop policy if exists "Anyone can insert incoming" on orders_incoming;
create policy "Anyone can insert incoming" on orders_incoming
  for insert
  with check (
    (user_id is null or user_id = auth.uid())
    and jsonb_typeof(payload) = 'object'
    and pg_column_size(payload) < 8192
    and status = 'nouvelle'
  );

-- Garde-fou anti-flood : 30 commandes entrantes par minute au total,
-- 5 par minute pour un meme compte connecte.
create or replace function throttle_incoming_orders()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  recent_total int;
  recent_user  int;
begin
  select count(*) into recent_total
  from orders_incoming
  where created_at > now() - interval '1 minute';

  if recent_total >= 30 then
    raise exception 'Trop de commandes envoyees, reessaie dans une minute';
  end if;

  if new.user_id is not null then
    select count(*) into recent_user
    from orders_incoming
    where user_id = new.user_id
      and created_at > now() - interval '1 minute';

    if recent_user >= 5 then
      raise exception 'Trop de commandes envoyees, reessaie dans une minute';
    end if;
  end if;

  return new;
end;
$fn$;

drop trigger if exists throttle_incoming_orders_trg on orders_incoming;
create trigger throttle_incoming_orders_trg
  before insert on orders_incoming
  for each row execute function throttle_incoming_orders();

-- Menage : les commandes entrantes deja traitees n'ont pas a rester
-- indefiniment (elles contiennent nom + telephone + adresse).
drop policy if exists "Admin delete incoming" on orders_incoming;
create policy "Admin delete incoming" on orders_incoming
  for delete using (is_admin());


-- ============================================================================
-- 5) VERIFICATION
-- ============================================================================
-- Doit retourner 0 ligne : plus aucune politique d'insertion ouverte a anon
-- sur orders / clients.
--
--   select tablename, policyname, roles
--   from pg_policies
--   where schemaname = 'public'
--     and tablename in ('orders', 'clients')
--     and cmd = 'INSERT'
--     and 'anon' = any (roles);
--
-- Test d'elevation de privileges (doit laisser role = 'client') :
--
--   select id, role from profiles order by created_at desc limit 5;
-- ============================================================================
