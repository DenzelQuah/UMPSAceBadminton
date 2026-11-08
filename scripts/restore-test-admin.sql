-- Review and run manually in Supabase Dashboard > SQL Editor as the project owner.
-- Restores only the documented development Administrator account. This script
-- does not create users, change passwords, activate other roles or create fixtures.
BEGIN;

DO $$
DECLARE
  previous_profile public.profiles%ROWTYPE;
  restored_profile public.profiles%ROWTYPE;
BEGIN
  SELECT * INTO previous_profile
  FROM public.profiles
  WHERE email = 'codex-test-admin@umpsa.edu.my'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The documented test Administrator account does not exist. Verify TEST_ADMIN_EMAIL and create its Auth account first.';
  END IF;

  IF previous_profile.is_admin IS TRUE THEN RETURN; END IF;

  UPDATE public.profiles SET is_admin = TRUE
  WHERE id = previous_profile.id
  RETURNING * INTO restored_profile;

  INSERT INTO public.audit_logs(actor_id, action, entity_type, entity_id, original_data, new_data, reason)
  VALUES (auth.uid(), 'TEST_ADMIN_ACCESS_RESTORED', 'profile', restored_profile.id,
    to_jsonb(previous_profile), to_jsonb(restored_profile),
    'Project owner restored the documented development administrator account.');
END;
$$;

COMMIT;

SELECT email, is_admin
FROM public.profiles
WHERE email = 'codex-test-admin@umpsa.edu.my';
