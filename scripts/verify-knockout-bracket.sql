-- Read-only verification for the knockout bracket migration.
select
  to_regclass('public.category_knockout_previews') as preview_table,
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'matches'
      and column_name = 'knockout_stage'
  ) as stage_column,
  exists (
    select 1
    from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname = 'publish_category_knockout_bracket'
  ) as publish_function;

notify pgrst, 'reload schema';
