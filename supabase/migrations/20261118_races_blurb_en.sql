-- Description courte en anglais, utilisée par les vignettes Instagram bilingues.
alter table public.races add column if not exists blurb_en text;
comment on column public.races.blurb_en is 'Description courte en anglais (vignettes Instagram bilingues, version anglaise).';
