-- Supabase Storage pour photos produits
-- SQL Editor → Run (apres le schema principal)

insert into storage.buckets (id, name, public)
values ('product-photos', 'product-photos', true)
on conflict (id) do update set public = true;

drop policy if exists "Public read product photos" on storage.objects;
drop policy if exists "Admin upload product photos" on storage.objects;
drop policy if exists "Admin update product photos" on storage.objects;
drop policy if exists "Admin delete product photos" on storage.objects;

create policy "Public read product photos"
on storage.objects for select
using (bucket_id = 'product-photos');

create policy "Admin upload product photos"
on storage.objects for insert
with check (bucket_id = 'product-photos' and public.is_admin());

create policy "Admin update product photos"
on storage.objects for update
using (bucket_id = 'product-photos' and public.is_admin());

create policy "Admin delete product photos"
on storage.objects for delete
using (bucket_id = 'product-photos' and public.is_admin());
