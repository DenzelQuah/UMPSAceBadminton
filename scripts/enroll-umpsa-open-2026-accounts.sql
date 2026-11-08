-- Project owner: review and run in Supabase Dashboard > SQL Editor.
-- Enrolls the ten accounts present when this request was made into the new
-- UMPSA OPEN 2026 Men's Single category. Existing entries are preserved.
-- No accounts, privileges, seeds, partners, draws or match results are changed.
BEGIN;

DO $$
DECLARE
  target_category CONSTANT UUID := '57280a5d-36b3-4f70-84eb-dbb14adb2d17';
  target_tournament CONSTANT UUID := '4586d57c-e1ee-447e-8373-af3eccbd925a';
  account_ids CONSTANT UUID[] := ARRAY[
    'fff46f5a-39a8-433c-9739-060580a526a1',
    'e76e8654-891d-4d56-a9c2-1d2ca8cf4e6b',
    'aa34ce8a-4e72-484f-b025-46d89246481a',
    '1ff8d695-cea0-49b3-b69b-0961357eec3d',
    '2d31925d-6f63-48ed-9609-d78642c0e21a',
    '4ab111a6-40b1-4f68-9e6f-271162f00653',
    '867c0c3f-8f4c-4f30-8de7-3687b67c0a0a',
    '5ab72092-21d2-4dc1-bc8d-561e1cd9e336',
    '13446251-8c98-4a45-a1a0-4ad3808dd573',
    'eb36d22b-d456-41f3-9d8b-eb273cb0eb0e'
  ]::UUID[];
  category_record public.categories%ROWTYPE;
  previous_registration public.registrations%ROWTYPE;
  saved_registration public.registrations%ROWTYPE;
  account_id UUID;
  confirmed_count INTEGER;
  entry_status public.registration_status;
BEGIN
  SELECT * INTO category_record FROM public.categories
    WHERE id = target_category AND tournament_id = target_tournament FOR UPDATE;
  IF NOT FOUND OR category_record.status <> 'REGISTRATION_OPEN'
      OR category_record.participation_format <> 'SINGLES' THEN
    RAISE EXCEPTION 'The target singles category must exist and have registration open.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tournaments WHERE id = target_tournament
      AND title = 'UMPSA OPEN 2026' AND status NOT IN ('COMPLETED', 'ARCHIVED')) THEN
    RAISE EXCEPTION 'The target tournament is missing, renamed or locked.';
  END IF;
  IF (SELECT count(*) FROM public.profiles WHERE id = ANY(account_ids)) <> cardinality(account_ids) THEN
    RAISE EXCEPTION 'One of the intended accounts no longer exists. No registrations were changed.';
  END IF;

  FOREACH account_id IN ARRAY account_ids LOOP
    SELECT * INTO previous_registration FROM public.registrations
      WHERE category_id = target_category AND player_id = account_id FOR UPDATE;
    IF FOUND AND previous_registration.status <> 'WITHDRAWN' THEN CONTINUE; END IF;

    SELECT count(*) INTO confirmed_count FROM public.registrations
      WHERE category_id = target_category AND status = 'CONFIRMED';
    entry_status := CASE WHEN confirmed_count < category_record.max_capacity
      THEN 'CONFIRMED'::public.registration_status ELSE 'WAITLISTED'::public.registration_status END;

    INSERT INTO public.registrations(category_id, player_id, status)
      VALUES(target_category, account_id, entry_status)
      ON CONFLICT (category_id, player_id) DO UPDATE
      SET status = EXCLUDED.status, created_at = now(), seed_number = NULL
      WHERE public.registrations.status = 'WITHDRAWN'
      RETURNING * INTO saved_registration;

    INSERT INTO public.audit_logs(actor_id, action, entity_type, entity_id, original_data, new_data, reason)
      VALUES(auth.uid(), 'ADMIN_PLAYER_REGISTERED', 'registration', saved_registration.id,
        to_jsonb(previous_registration), to_jsonb(saved_registration),
        'Project owner requested all existing accounts to join UMPSA OPEN 2026.');
  END LOOP;
END;
$$;

COMMIT;

SELECT p.full_name, r.status
FROM public.registrations r JOIN public.profiles p ON p.id = r.player_id
WHERE r.category_id = '57280a5d-36b3-4f70-84eb-dbb14adb2d17'
ORDER BY p.full_name;
