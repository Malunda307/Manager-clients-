-- Ajouts pour suivi commande (code 4 chiffres + RPC public)
-- SQL Editor → Run une fois

alter table orders_incoming
  add column if not exists code text;

create index if not exists orders_incoming_code_idx on orders_incoming(code);

-- Lecture du statut par code (client non connecte)
create or replace function public.get_order_status(p_code text)
returns table(status text, created_at timestamptz)
language sql
security definer
set search_path = public
as $fn$
  select o.status, o.created_at
  from orders_incoming o
  where o.code = p_code
  order by o.created_at desc
  limit 1;
$fn$;

grant execute on function public.get_order_status(text) to anon, authenticated;
