-- Onglet « Notifications » de l'admin : auteur et sujet de chaque envoi,
-- historique lisible par les admins seulement.
alter table public.push_notifications
  add column if not exists topic text,
  add column if not exists sent_by uuid references auth.users(id) on delete set null;
alter table public.push_notifications enable row level security;
drop policy if exists push_notifications_admin_read on public.push_notifications;
create policy push_notifications_admin_read on public.push_notifications
  for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));
