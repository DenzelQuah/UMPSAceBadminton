-- Run after the disposable Auth users have been created in Dashboard.
-- This script only updates their profiles and creates the disposable fixture.

update public.profiles
set
  full_name = case email
    when 'codex-test-player-01@umpsa.edu.my' then 'Codex Test Player 01'
    when 'codex-test-player-02@umpsa.edu.my' then 'Codex Test Player 02'
    when 'codex-test-player-03@umpsa.edu.my' then 'Codex Test Player 03'
    when 'codex-test-player-04@umpsa.edu.my' then 'Codex Test Player 04'
    when 'codex-test-umpire@umpsa.edu.my' then 'Codex Test MT'
    when 'codex-test-linesman@umpsa.edu.my' then 'Codex Test EXCO'
    when 'codex-test-admin@umpsa.edu.my' then 'Codex Test Administrator'
    else full_name
  end,
  is_admin = (email = 'codex-test-admin@umpsa.edu.my'),
  is_community_member = false
where email like 'codex-test-%@umpsa.edu.my';

begin;

-- MT/EXCO fixture identities request organizational access; the administrator
-- reviews them through /admin/users. Test account labels do not grant roles.
DO $$ BEGIN
  IF to_regclass('public.organization_role_requests') IS NOT NULL THEN
    INSERT INTO public.organization_role_requests(user_id,requested_role,role_detail)
    SELECT id,CASE WHEN email='codex-test-umpire@umpsa.edu.my' THEN 'MT' ELSE 'EXCO' END,
      CASE WHEN email='codex-test-umpire@umpsa.edu.my' THEN 'Other Majlis Tertinggi' ELSE 'Technical' END
    FROM public.profiles WHERE email IN ('codex-test-umpire@umpsa.edu.my','codex-test-linesman@umpsa.edu.my')
      AND organizational_role='PLAYER' AND NOT is_admin
    ON CONFLICT(user_id) WHERE status='PENDING' DO NOTHING;
  END IF;
END $$;

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
  (select count(*) from public.profiles where email like 'codex-test-%@umpsa.edu.my') as test_profiles,
  (select count(*) from public.tournaments where id = '00000000-0000-0000-0000-000000000601') as test_tournaments,
  (select count(*) from public.categories where id = '00000000-0000-0000-0000-000000000602') as test_categories;
