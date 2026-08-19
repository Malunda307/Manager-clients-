-- ============================================================
-- Photos produits — Supabase Storage
-- A lancer APRES supabase-schema.sql (qui cree deja is_admin)
-- ============================================================

-- 1) Bucket public
insert into storage.buckets (id, name, public)
values ('product-photos', 'product-photos', true)
on conflict (id) do update set public = true;

-- 2) S'assurer que is_admin() existe (meme definition que le schema)
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$fn$;

-- 3) Policies UNIQUEMENT pour ce bucket (on ne touche pas aux autres)
drop policy if exists "Public read product photos" on storage.objects;
drop policy if exists "Admin upload product photos" on storage.objects;
drop policy if exists "Admin update product photos" on storage.objects;
drop policy if exists "Admin delete product photos" on storage.objects;

create policy "Public read product photos"
on storage.objects for select
using (bucket_id = 'product-photos');

create policy "Admin upload product photos"
on storage.objects for insert
with check (
  bucket_id = 'product-photos'
  and auth.role() = 'authenticated'
  and public.is_admin()
);

create policy "Admin update product photos"
on storage.objects for update
using (
  bucket_id = 'product-photos'
  and auth.role() = 'authenticated'
  and public.is_admin()
);

create policy "Admin delete product photos"
on storage.objects for delete
using (
  bucket_id = 'product-photos'
  and auth.role() = 'authenticated'
  and public.is_admin()
);
