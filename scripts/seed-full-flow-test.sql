-- Disposable full-flow fixture. Run manually in Supabase SQL Editor.
-- This is test data, not a migration. Do not run against a real event.

begin;

insert into public.tournaments (
  id, title, description, location, court_count, start_date, end_date, status
)
values (
  '00000000-0000-0000-0000-000000000601',
  'Codex Full Flow Test 2026-09-25',
  'Disposable tournament for the authenticated player, official, and committee rehearsal.',
  'UMPSA Test Hall',
  2,
  '2026-10-10 09:00:00+08',
  '2026-10-10 18:00:00+08',
  'DRAFT'
)
on conflict (id) do nothing;

insert into public.categories (
  id, tournament_id, name, max_capacity, group_count, qualifiers_per_group, format, status
)
values (
  '00000000-0000-0000-0000-000000000602',
  '00000000-0000-0000-0000-000000000601',
  'Codex Full Flow Singles',
  8,
  2,
  1,
  'STANDARD_3X21',
  'DRAFT'
)
on conflict (id) do nothing;

commit;

select
  '00000000-0000-0000-0000-000000000601'::uuid as tournament_id,
  '00000000-0000-0000-0000-000000000602'::uuid as category_id,
  'Codex Full Flow Test 2026-09-25' as title;
