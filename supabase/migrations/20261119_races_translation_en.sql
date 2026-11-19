-- Traduction anglaise des fiches ultras, affichée directement dans la fiche.
--
-- blurb_en (déjà présent), long_blurb_en, terrain_en : textes anglais.
-- en_source_md5 : empreinte du français au moment de la traduction ; si le
--   français change, la traduction est périmée.
-- en_reviewed : la version anglaise a été écrite ou corrigée à la main ; on ne
--   l'écrase plus automatiquement (l'interface propose de régénérer).
-- en_translated_at : date de la dernière traduction automatique.

alter table public.races
  add column if not exists long_blurb_en text,
  add column if not exists terrain_en text,
  add column if not exists en_source_md5 text,
  add column if not exists en_reviewed boolean not null default false,
  add column if not exists en_translated_at timestamptz;

-- Empreinte du texte français d'une fiche.
create or replace function public.race_fr_md5(p_blurb text, p_long text, p_terrain text)
returns text language sql immutable as $$
  select md5(coalesce(p_blurb, '') || '|' || coalesce(p_long, '') || '|' || coalesce(p_terrain, ''))
$$;

-- Trigger de garde : une mise à jour qui ne touche que la traduction est
-- autorisée sans repasser la fiche en attente (Edge Function, organisateur).
create or replace function public.races_before_update()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  the_role public.user_role;
  tr_cols text[] := array['blurb_en','long_blurb_en','terrain_en','en_source_md5','en_reviewed','en_translated_at','updated_at'];
begin
  -- Exception 0 : recalcul automatique de is_current, et rien d'autre.
  if (to_jsonb(new) - 'is_current') = (to_jsonb(old) - 'is_current') then
    return new;
  end if;

  -- Exception 1 : incrément du compteur de vues, et rien d'autre.
  if (to_jsonb(new) - 'view_count') = (to_jsonb(old) - 'view_count')
     and new.view_count = old.view_count + 1 then
    return new;
  end if;

  -- Exception 2 : pose ou levée d'une demande de suppression, et rien d'autre.
  if (to_jsonb(new) - 'deletion_requested' - 'deletion_reason')
     = (to_jsonb(old) - 'deletion_requested' - 'deletion_reason') then
    return new;
  end if;

  select role into the_role from public.profiles where id = auth.uid();

  -- Exception 3 : seule la traduction anglaise change.
  -- Service (Edge Function, auth.uid() nul), admin ou organisateur de la fiche.
  if (to_jsonb(new) - tr_cols) = (to_jsonb(old) - tr_cols)
     and (auth.uid() is null or the_role = 'admin'
          or (the_role = 'organizer' and old.created_by = auth.uid())) then
    return new;
  end if;

  if the_role = 'admin' then
    return new;
  elsif the_role = 'organizer' and old.created_by = auth.uid() then
    new.status := 'pending';
    new.created_by := old.created_by;
    new.reviewed_by := null;
    new.view_count := old.view_count;
    return new;
  else
    raise exception 'Non autorisé à modifier cette course.';
  end if;
end;
$function$;

-- Traduction automatique : quand une fiche publiée a un français différent
-- de celui traduit et que l'anglais n'a pas été relu, on appelle
-- l'Edge Function translate-race (pg_net, asynchrone).
create or replace function public.queue_race_translation()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  secret text;
begin
  if new.status <> 'published' or new.en_reviewed then
    return new;
  end if;
  if new.en_source_md5 is not distinct from public.race_fr_md5(new.blurb, new.long_blurb, new.terrain) then
    return new;
  end if;
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'translate_race_token';
  if secret is null then
    return new;
  end if;
  perform net.http_post(
    url := 'https://fvykkcgwnomynnbhiggh.supabase.co/functions/v1/translate-race',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', secret),
    body := jsonb_build_object('race_id', new.id),
    timeout_milliseconds := 60000
  );
  return new;
end;
$$;

drop trigger if exists races_queue_translation on public.races;
create trigger races_queue_translation
  after insert or update of status, blurb, long_blurb, terrain, en_reviewed on public.races
  for each row execute function public.queue_race_translation();

-- Jeton partagé avec l'Edge Function.
create or replace function public.translate_race_token_ok(p_token text)
returns boolean language sql security definer set search_path to 'public' as $$
  select exists (select 1 from vault.decrypted_secrets where name = 'translate_race_token' and decrypted_secret = p_token)
$$;
revoke all on function public.translate_race_token_ok(text) from public, anon, authenticated;
grant execute on function public.translate_race_token_ok(text) to service_role;

-- Fiches publiées à traduire (anglais absent ou périmé, non relu).
create or replace function public.races_needing_translation(p_limit int default 20)
returns table(id uuid) language sql stable security definer set search_path to 'public' as $$
  select r.id from public.races r
  where r.status = 'published' and not r.en_reviewed
    and (coalesce(r.blurb, '') <> '' or coalesce(r.long_blurb, '') <> '' or coalesce(r.terrain, '') <> '')
    and r.en_source_md5 is distinct from public.race_fr_md5(r.blurb, r.long_blurb, r.terrain)
  order by r.view_count desc nulls last
  limit p_limit
$$;

create or replace function public.races_needing_translation_count()
returns int language sql stable security definer set search_path to 'public' as $$
  select count(*)::int from public.races r
  where r.status = 'published' and not r.en_reviewed
    and (coalesce(r.blurb, '') <> '' or coalesce(r.long_blurb, '') <> '' or coalesce(r.terrain, '') <> '')
    and r.en_source_md5 is distinct from public.race_fr_md5(r.blurb, r.long_blurb, r.terrain)
$$;

revoke all on function public.races_needing_translation(int) from public, anon, authenticated;
revoke all on function public.races_needing_translation_count() from public, anon, authenticated;
grant execute on function public.races_needing_translation(int) to service_role;
grant execute on function public.races_needing_translation_count() to service_role;
