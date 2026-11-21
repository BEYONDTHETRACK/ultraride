-- Type des robots qui visitent le site (supervision).
-- Le client classe le robot d'après son user-agent (Google, Bing, IA,
-- réseaux sociaux, outils SEO, navigateurs automatisés, autres moteurs, autres)
-- et n'envoie que cette catégorie : aucune donnée personnelle, pas d'user-agent stocké.
-- Le total des robots reste compté par track_visit(p_bot) comme avant.

create table if not exists public.site_bot_visits_daily (
  day date not null,
  kind text not null check (kind in ('google','bing','moteurs','ia','social','seo','automatise','autre')),
  n integer not null default 0,
  primary key (day, kind)
);
alter table public.site_bot_visits_daily enable row level security;
-- Pas de policy : lecture et écriture seulement via les fonctions ci-dessous.

create or replace function public.track_bot_kind(p_kind text)
returns void language plpgsql security definer set search_path to 'public' as $$
declare k text := case when p_kind in ('google','bing','moteurs','ia','social','seo','automatise','autre') then p_kind else 'autre' end;
begin
  insert into public.site_bot_visits_daily(day, kind, n)
  values ((now() at time zone 'Europe/Paris')::date, k, 1)
  on conflict (day, kind) do update set n = site_bot_visits_daily.n + 1;
end $$;
revoke all on function public.track_bot_kind(text) from public;
grant execute on function public.track_bot_kind(text) to anon, authenticated;

create or replace function public.admin_bot_kinds(days integer default 30)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare since date := (now() at time zone 'Europe/Paris')::date - greatest(days, 1) + 1;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    raise exception 'Réservé aux admins';
  end if;
  return jsonb_build_object(
    'totals', coalesce((select jsonb_agg(jsonb_build_object('kind', kind, 'n', s) order by s desc)
                        from (select kind, sum(n)::int s from public.site_bot_visits_daily where day >= since group by kind) x), '[]'::jsonb),
    'daily', coalesce((select jsonb_object_agg(day::text, kinds)
                       from (select day, jsonb_object_agg(kind, n) kinds from public.site_bot_visits_daily where day >= since group by day) d), '{}'::jsonb)
  );
end $$;
revoke all on function public.admin_bot_kinds(integer) from public, anon;
grant execute on function public.admin_bot_kinds(integer) to authenticated;
