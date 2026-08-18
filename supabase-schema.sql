-- Dinner Burger schema - coller TOUT puis Run
--
-- IMPORTANT : execute ENSUITE `supabase-security-fix.sql`, qui ajoute les
-- triggers de securite (integrite des commandes, protection du role admin,
-- anti-flood). Ce fichier-ci ne cree que les tables et les politiques RLS.

create extension if not exists pgcrypto;

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'client' check (role in ('admin', 'client')),
  name text,
  phone text,
  created_at timestamptz default now()
);

create table if not exists config (
  id int primary key default 1 check (id = 1),
  currency text not null default 'FC',
  default_com numeric not null default 500,
  reinvest_rate numeric not null default 30,
  goal_orders int not null default 500,
  goal_revenue numeric not null default 1500000,
  whatsapp text default ''
);
insert into config (id) values (1) on conflict (id) do nothing;

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  price numeric not null default 0,
  cost numeric not null default 0,
  category text not null default 'other',
  available boolean not null default true,
  emoji text default '🍽️',
  photo text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  name text not null,
  phone text,
  orders_count int not null default 0,
  total numeric not null default 0,
  first_order timestamptz,
  last_order timestamptz,
  ambassador text default '',
  created_at timestamptz default now()
);
create index if not exists clients_user_id_idx on clients(user_id);
create index if not exists clients_phone_idx on clients(phone);

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete set null,
  client_name text,
  user_id uuid references auth.users(id) on delete set null,
  items jsonb not null default '[]',
  total numeric not null default 0,
  cost numeric not null default 0,
  profit numeric not null default 0,
  payment text default 'cash',
  ambassador text default '',
  order_type text default 'emporter',
  address text,
  notes text,
  status text not null default 'validee',
  is_new_client boolean default false,
  created_at timestamptz default now()
);
create index if not exists orders_user_id_idx on orders(user_id);
create index if not exists orders_created_at_idx on orders(created_at desc);

create table if not exists ambassadors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null unique,
  phone text,
  new_clients int not null default 0,
  revenue numeric not null default 0,
  commission numeric not null default 0,
  paid numeric not null default 0,
  created_at timestamptz default now()
);

create table if not exists stocks (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  qty numeric not null default 0,
  min_qty numeric not null default 0,
  unit text default 'piece',
  cost numeric not null default 0,
  created_at timestamptz default now()
);

create table if not exists expenses (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  category text not null,
  amount numeric not null default 0,
  description text,
  created_at timestamptz default now()
);

create table if not exists goals (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  type text not null,
  target numeric not null default 0,
  deadline date,
  current_val numeric not null default 0,
  created_at timestamptz default now()
);

create table if not exists orders_incoming (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  payload jsonb not null,
  status text not null default 'nouvelle',
  user_id uuid references auth.users(id) on delete set null
);

alter table profiles enable row level security;
alter table config enable row level security;
alter table products enable row level security;
alter table clients enable row level security;
alter table orders enable row level security;
alter table ambassadors enable row level security;
alter table stocks enable row level security;
alter table expenses enable row level security;
alter table goals enable row level security;
alter table orders_incoming enable row level security;

create or replace function is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'admin'
  );
$fn$;

drop policy if exists "Users can read own profile" on profiles;
drop policy if exists "Users can update own profile" on profiles;
drop policy if exists "Admin can manage profiles" on profiles;
drop policy if exists "Insert own profile on signup" on profiles;
drop policy if exists "Anyone can read config" on config;
drop policy if exists "Admin can read config" on config;
drop policy if exists "Admin can update config" on config;
drop policy if exists "Admin can insert config" on config;
drop policy if exists "Anyone can read products" on products;
drop policy if exists "Admin can read products" on products;
drop policy if exists "Admin can insert products" on products;
drop policy if exists "Admin can update products" on products;
drop policy if exists "Admin can delete products" on products;
drop policy if exists "Admin full clients" on clients;
drop policy if exists "Client reads own row" on clients;
drop policy if exists "Client updates own row" on clients;
drop policy if exists "Authenticated can insert client" on clients;
drop policy if exists "Anon can insert client" on clients;
drop policy if exists "Admin full orders" on orders;
drop policy if exists "Client reads own orders" on orders;
drop policy if exists "Authenticated insert orders" on orders;
drop policy if exists "Anon insert orders" on orders;
drop policy if exists "Anyone can read ambassadors" on ambassadors;
drop policy if exists "Admin can read ambassadors" on ambassadors;
drop policy if exists "Admin insert ambassadors" on ambassadors;
drop policy if exists "Admin update ambassadors" on ambassadors;
drop policy if exists "Admin delete ambassadors" on ambassadors;
drop policy if exists "Admin stocks" on stocks;
drop policy if exists "Admin expenses" on expenses;
drop policy if exists "Admin goals" on goals;
drop policy if exists "Anyone can insert incoming" on orders_incoming;
drop policy if exists "Admin delete incoming" on orders_incoming;
drop policy if exists "Client inserts own row" on clients;
drop policy if exists "Client inserts own order" on orders;
drop policy if exists "Admin read incoming" on orders_incoming;
drop policy if exists "Admin update incoming" on orders_incoming;

create policy "Users can read own profile" on profiles
  for select using (auth.uid() = id or is_admin());
create policy "Users can update own profile" on profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);
create policy "Admin can manage profiles" on profiles
  for all using (is_admin()) with check (is_admin());
create policy "Insert own profile on signup" on profiles
  for insert with check (auth.uid() = id);

-- Lecture publique via la vue public_config uniquement (voir plus bas) : la
-- table porte les objectifs de CA et le taux de reinvestissement.
create policy "Admin can read config" on config for select using (is_admin());
create policy "Admin can update config" on config for update using (is_admin()) with check (is_admin());
create policy "Admin can insert config" on config for insert with check (is_admin());

-- Lecture publique via la vue public_products uniquement (voir plus bas) : la
-- table porte la colonne cost, donc tes marges.
create policy "Admin can read products" on products for select using (is_admin());
create policy "Admin can insert products" on products for insert with check (is_admin());
create policy "Admin can update products" on products for update using (is_admin()) with check (is_admin());
create policy "Admin can delete products" on products for delete using (is_admin());

create policy "Admin full clients" on clients for all using (is_admin()) with check (is_admin());
create policy "Client reads own row" on clients for select using (user_id = auth.uid());
create policy "Client updates own row" on clients for update using (user_id = auth.uid()) with check (user_id = auth.uid());
-- Un client authentifie ne peut creer QUE sa propre fiche.
-- (anon n'insere plus rien ici : les commandes anonymes passent par orders_incoming)
create policy "Client inserts own row" on clients for insert to authenticated with check (user_id = auth.uid());

create policy "Admin full orders" on orders for all using (is_admin()) with check (is_admin());
create policy "Client reads own orders" on orders for select using (user_id = auth.uid());
-- Un client authentifie ne peut inserer qu'une commande qui lui appartient.
-- Les montants sont recalcules cote serveur (voir supabase-security-fix.sql).
create policy "Client inserts own order" on orders for insert to authenticated with check (user_id = auth.uid());

-- Commissions, montants payes et telephones : rien de public ici.
create policy "Admin can read ambassadors" on ambassadors for select using (is_admin());
create policy "Admin insert ambassadors" on ambassadors for insert with check (is_admin());
create policy "Admin update ambassadors" on ambassadors for update using (is_admin()) with check (is_admin());
create policy "Admin delete ambassadors" on ambassadors for delete using (is_admin());

create policy "Admin stocks" on stocks for all using (is_admin()) with check (is_admin());
create policy "Admin expenses" on expenses for all using (is_admin()) with check (is_admin());
create policy "Admin goals" on goals for all using (is_admin()) with check (is_admin());

create policy "Anyone can insert incoming" on orders_incoming for insert with check (
  (user_id is null or user_id = auth.uid())
  and jsonb_typeof(payload) = 'object'
  and pg_column_size(payload) < 8192
  and status = 'nouvelle'
);
create policy "Admin delete incoming" on orders_incoming for delete using (is_admin());
create policy "Admin read incoming" on orders_incoming for select using (is_admin());
create policy "Admin update incoming" on orders_incoming for update using (is_admin()) with check (is_admin());

create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  -- Le role n'est JAMAIS lu depuis raw_user_meta_data : cette donnee est
  -- envoyee par le navigateur, donc un client pourrait s'inscrire admin.
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

insert into products (name, price, cost, category, available, emoji)
select v.name, v.price, v.cost, v.category, v.available, v.emoji
from (
  select 'Classic Burger' as name, 3000::numeric as price, 1500::numeric as cost, 'burger' as category, true as available, '🍔' as emoji
  union all select 'Cheese Burger', 3500, 1800, 'burger', true, '🧀'
  union all select 'Double Burger', 4500, 2200, 'burger', true, '🥩'
  union all select 'Coca 33cl', 800, 400, 'drink', true, '🥤'
  union all select 'Frites Moyennes', 1000, 300, 'fries', true, '🍟'
  union all select 'Frites Grandes', 1500, 450, 'fries', true, '🍟'
  union all select 'Eau minerale', 500, 200, 'drink', true, '💧'
) v
where not exists (select 1 from products limit 1);

insert into stocks (name, qty, min_qty, unit, cost)
select v.name, v.qty, v.min_qty, v.unit, v.cost
from (
  select 'Pains' as name, 50::numeric as qty, 10::numeric as min_qty, 'piece' as unit, 100::numeric as cost
  union all select 'Steaks', 40, 10, 'piece', 500
  union all select 'Fromage', 30, 5, 'tranche', 150
  union all select 'Tomates', 5, 2, 'kg', 2000
  union all select 'Coca', 24, 6, 'bouteille', 350
  union all select 'Pommes de terre', 20, 5, 'kg', 800
  union all select 'Emballages', 100, 20, 'piece', 50
) v
where not exists (select 1 from stocks limit 1);


-- ============================================================================
-- VUES PUBLIQUES
-- ============================================================================
-- Le menu doit etre lisible par tout le monde pour pouvoir commander, mais sans
-- exposer les prix d'achat ni les objectifs internes. security_invoker = off :
-- la vue s'execute avec les droits de son proprietaire et traverse donc le RLS
-- de la table de base.

create or replace view public_products as
  select id, name, price, category, available, emoji, photo, updated_at
  from products;

create or replace view public_config as
  select id, currency, whatsapp
  from config;

do $$
begin
  execute 'alter view public_products set (security_invoker = off)';
  execute 'alter view public_config set (security_invoker = off)';
exception
  when others then
    raise notice 'security_invoker non supporte, comportement par defaut conserve';
end $$;

revoke all on public_products from anon, authenticated;
revoke all on public_config   from anon, authenticated;
grant select on public_products to anon, authenticated;
grant select on public_config   to anon, authenticated;
