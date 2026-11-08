-- Standardize registration/seed locking on category first, then registration.
-- This removes the registration-first/category-second cycle with registration
-- and waitlist operations while preserving the existing RPC contract.

CREATE OR REPLACE FUNCTION public.set_registration_seed(
  registration_uuid UUID,
  seed_value INTEGER
)
RETURNS public.registrations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  category_uuid UUID;
  registration_record public.registrations%ROWTYPE;
  category_record public.categories%ROWTYPE;
  previous_seed INTEGER;
BEGIN
  IF NOT (SELECT private.is_committee_member()) THEN
    RAISE EXCEPTION 'Administrator access is required.'
      USING ERRCODE = '42501';
  END IF;

  IF seed_value IS NOT NULL AND seed_value < 1 THEN
    RAISE EXCEPTION 'Seed numbers must be positive.'
      USING ERRCODE = '23514';
  END IF;

  SELECT registration.category_id
  INTO category_uuid
  FROM public.registrations AS registration
  WHERE registration.id = registration_uuid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Registration not found.'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT category.*
  INTO category_record
  FROM public.categories AS category
  WHERE category.id = category_uuid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Category not found.'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT registration.*
  INTO registration_record
  FROM public.registrations AS registration
  WHERE registration.id = registration_uuid
    AND registration.category_id = category_uuid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Registration not found.'
      USING ERRCODE = 'P0002';
  END IF;

  IF category_record.status NOT IN ('REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'DRAW_PREPARATION') THEN
    RAISE EXCEPTION 'Seeds cannot be changed after the draw is generated.'
      USING ERRCODE = 'P0001';
  END IF;

  previous_seed := registration_record.seed_number;

  UPDATE public.registrations
  SET seed_number = seed_value
  WHERE id = registration_uuid
  RETURNING * INTO registration_record;

  INSERT INTO public.audit_logs (
    actor_id,
    action,
    entity_type,
    entity_id,
    original_data,
    new_data
  )
  VALUES (
    (SELECT auth.uid()),
    'REGISTRATION_SEED_CHANGED',
    'registration',
    registration_uuid,
    jsonb_build_object('seed_number', previous_seed),
    jsonb_build_object('seed_number', seed_value)
  );

  RETURN registration_record;
END;
$$;
