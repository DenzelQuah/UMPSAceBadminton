-- Committee workflow hardening: authorization, atomic registration/draw operations,
-- safe scheduling primitives, profile provisioning, and immutable audit history.

-- -----------------------------------------------------------------------------
-- Schema foundations
-- -----------------------------------------------------------------------------

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO authenticated;

-- Do not let newly created public functions inherit Data API EXECUTE grants.
-- Individual RPCs below are granted explicitly only to authenticated callers.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated, service_role;

ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS status tournament_status NOT NULL DEFAULT 'DRAFT';

-- The connected project originally had a text lifecycle column. Normalize it
-- so database constraints, RLS comparisons, and the app share one enum type.
ALTER TABLE public.tournaments
  ALTER COLUMN status DROP DEFAULT;
ALTER TABLE public.tournaments
  ALTER COLUMN status TYPE tournament_status USING status::tournament_status;
ALTER TABLE public.tournaments
  ALTER COLUMN status SET DEFAULT 'DRAFT';

CREATE INDEX IF NOT EXISTS tournaments_status_start_date_idx
  ON public.tournaments (status, start_date);

ALTER TABLE public.matches
  ALTER COLUMN court_number DROP NOT NULL,
  ALTER COLUMN scheduled_time DROP NOT NULL,
  ALTER COLUMN estimated_start_time DROP NOT NULL;

CREATE INDEX IF NOT EXISTS matches_schedule_idx
  ON public.matches (category_id, scheduled_time, court_number)
  WHERE scheduled_time IS NOT NULL;

CREATE INDEX IF NOT EXISTS matches_player_a_schedule_idx
  ON public.matches (player_a_id, scheduled_time)
  WHERE scheduled_time IS NOT NULL;

CREATE INDEX IF NOT EXISTS matches_player_b_schedule_idx
  ON public.matches (player_b_id, scheduled_time)
  WHERE scheduled_time IS NOT NULL;

CREATE INDEX IF NOT EXISTS matches_umpire_schedule_idx
  ON public.matches (umpire_id, scheduled_time)
  WHERE scheduled_time IS NOT NULL;

CREATE INDEX IF NOT EXISTS matches_linesman_schedule_idx
  ON public.matches (linesman_id, scheduled_time)
  WHERE scheduled_time IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'match_games_game_number_range'
      AND conrelid = 'public.match_games'::regclass
  ) THEN
    ALTER TABLE public.match_games
      ADD CONSTRAINT match_games_game_number_range
      CHECK (game_number BETWEEN 1 AND 3);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'match_games_unique_game_number'
      AND conrelid = 'public.match_games'::regclass
  ) THEN
    ALTER TABLE public.match_games
      ADD CONSTRAINT match_games_unique_game_number
      UNIQUE (match_id, game_number);
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.category_draw_previews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID NOT NULL UNIQUE REFERENCES public.categories(id) ON DELETE CASCADE,
  groups_payload JSONB NOT NULL CHECK (jsonb_typeof(groups_payload) = 'array'),
  matches_count INTEGER NOT NULL DEFAULT 0 CHECK (matches_count >= 0),
  status VARCHAR(30) NOT NULL DEFAULT 'READY'
    CHECK (status IN ('READY', 'PUBLISHED', 'CANCELLED')),
  generated_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  generated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  published_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
  published_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS rankings_processed_at TIMESTAMP WITH TIME ZONE;

CREATE TABLE IF NOT EXISTS public.global_rankings (
  profile_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  ranking_points INTEGER NOT NULL DEFAULT 0 CHECK (ranking_points >= 0),
  net_points INTEGER NOT NULL DEFAULT 0,
  matches_won INTEGER NOT NULL DEFAULT 0 CHECK (matches_won >= 0),
  matches_played INTEGER NOT NULL DEFAULT 0 CHECK (matches_played >= 0),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(100) NOT NULL,
  entity_id UUID,
  original_data JSONB,
  new_data JSONB,
  reason TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_logs_entity_created_idx
  ON public.audit_logs (entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_actor_created_idx
  ON public.audit_logs (actor_id, created_at DESC);

-- -----------------------------------------------------------------------------
-- Private authorization and profile provisioning helpers
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.is_committee_member()
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM public.profiles AS profile
    WHERE profile.id = (SELECT auth.uid())
      AND profile.is_admin = TRUE
  );
END;
$$;

REVOKE ALL ON FUNCTION private.is_committee_member() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.is_committee_member() TO authenticated;

CREATE OR REPLACE FUNCTION private.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  normalized_email TEXT;
  profile_name TEXT;
  profile_matric_number TEXT;
BEGIN
  normalized_email := lower(trim(NEW.email));

  IF normalized_email IS NULL OR normalized_email !~* '^[^[:space:]]+@(adab\.)?umpsa\.edu\.my$' THEN
    RAISE EXCEPTION 'Only institutional UMPSA email addresses are allowed.'
      USING ERRCODE = '42501';
  END IF;

  profile_name := coalesce(
    nullif(trim(NEW.raw_user_meta_data ->> 'full_name'), ''),
    split_part(normalized_email, '@', 1)
  );
  profile_matric_number := nullif(
    trim(NEW.raw_user_meta_data ->> 'matric_number'),
    ''
  );

  INSERT INTO public.profiles (
    id,
    full_name,
    email,
    matric_number,
    is_admin,
    is_community_member
  )
  VALUES (
    NEW.id,
    profile_name,
    normalized_email,
    profile_matric_number,
    FALSE,
    FALSE
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.handle_new_user() FROM PUBLIC;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION private.handle_new_user();

INSERT INTO public.profiles (
  id,
  full_name,
  email,
  matric_number,
  is_admin,
  is_community_member
)
SELECT
  auth_user.id,
  coalesce(nullif(trim(auth_user.raw_user_meta_data ->> 'full_name'), ''), split_part(auth_user.email, '@', 1)),
  lower(auth_user.email),
  nullif(trim(auth_user.raw_user_meta_data ->> 'matric_number'), ''),
  FALSE,
  FALSE
FROM auth.users AS auth_user
WHERE auth_user.email IS NOT NULL
  AND lower(auth_user.email) ~* '^[^[:space:]]+@(adab\.)?umpsa\.edu\.my$'
  AND NOT EXISTS (
    SELECT 1
    FROM public.profiles AS profile
    WHERE profile.id = auth_user.id
  )
ON CONFLICT (id) DO NOTHING;

-- Public RPCs intentionally verify auth.uid() in their bodies. They are the only
-- route to privileged profile data or role changes.
CREATE OR REPLACE FUNCTION public.current_user_profile()
RETURNS TABLE (
  id UUID,
  full_name VARCHAR,
  email VARCHAR,
  matric_number VARCHAR,
  is_admin BOOLEAN,
  is_community_member BOOLEAN,
  created_at TIMESTAMP WITH TIME ZONE
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    profile.id,
    profile.full_name,
    profile.email,
    profile.matric_number,
    profile.is_admin,
    profile.is_community_member,
    profile.created_at
  FROM public.profiles AS profile
  WHERE profile.id = (SELECT auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.admin_list_profiles()
RETURNS TABLE (
  id UUID,
  full_name VARCHAR,
  email VARCHAR,
  matric_number VARCHAR,
  is_admin BOOLEAN,
  is_community_member BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT (SELECT private.is_committee_member()) THEN
    RAISE EXCEPTION 'Administrator access is required.'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    profile.id,
    profile.full_name,
    profile.email,
    profile.matric_number,
    profile.is_admin,
    profile.is_community_member
  FROM public.profiles AS profile
  ORDER BY profile.full_name;
END;
$$;

CREATE OR REPLACE FUNCTION public.available_officials()
RETURNS TABLE (
  id UUID,
  full_name VARCHAR,
  email VARCHAR
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT (SELECT private.is_committee_member()) THEN
    RAISE EXCEPTION 'Administrator access is required.'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT profile.id, profile.full_name, profile.email
  FROM public.profiles AS profile
  WHERE profile.is_admin = TRUE OR profile.is_community_member = TRUE
  ORDER BY profile.full_name;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_community_membership(
  target_profile_id UUID,
  enabled BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor UUID := (SELECT auth.uid());
  previous_status BOOLEAN;
  next_status BOOLEAN;
BEGIN
  IF NOT (SELECT private.is_committee_member()) THEN
    RAISE EXCEPTION 'Administrator access is required.'
      USING ERRCODE = '42501';
  END IF;

  IF target_profile_id = actor THEN
    RAISE EXCEPTION 'Administrators cannot change their own membership status.'
      USING ERRCODE = '42501';
  END IF;

  SELECT profile.is_community_member
  INTO previous_status
  FROM public.profiles AS profile
  WHERE profile.id = target_profile_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found.'
      USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.profiles
  SET is_community_member = enabled,
      updated_at = now()
  WHERE id = target_profile_id;

  SELECT profile.is_community_member
  INTO next_status
  FROM public.profiles AS profile
  WHERE profile.id = target_profile_id;

  INSERT INTO public.audit_logs (
    actor_id,
    action,
    entity_type,
    entity_id,
    original_data,
    new_data
  )
  VALUES (
    actor,
    'PROFILE_COMMUNITY_MEMBERSHIP_CHANGED',
    'profile',
    target_profile_id,
    jsonb_build_object('is_community_member', previous_status),
    jsonb_build_object('is_community_member', next_status)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.current_user_profile() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_list_profiles() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.available_officials() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_community_membership(UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_profile() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_profiles() TO authenticated;
GRANT EXECUTE ON FUNCTION public.available_officials() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_community_membership(UUID, BOOLEAN) TO authenticated;

-- -----------------------------------------------------------------------------
-- Row-level security and grants
-- -----------------------------------------------------------------------------

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournaments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_games ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.category_draw_previews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.global_rankings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Profiles: Allow users to select their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Profiles: Admins can update all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Profiles: Community members can select all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Profiles: Allow authenticated users to select all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Profiles: Authenticated directory can read public names" ON public.profiles;

DROP POLICY IF EXISTS "Tournaments: Authenticated users can read" ON public.tournaments;
DROP POLICY IF EXISTS "Tournaments: Committee can create" ON public.tournaments;
DROP POLICY IF EXISTS "Tournaments: Committee can update" ON public.tournaments;
DROP POLICY IF EXISTS "Tournaments: Committee can archive" ON public.tournaments;
DROP POLICY IF EXISTS "Allow public read access" ON public.tournaments;
DROP POLICY IF EXISTS "Organizers can create tournaments" ON public.tournaments;
DROP POLICY IF EXISTS "Organizers can update tournaments" ON public.tournaments;

DROP POLICY IF EXISTS "Categories: Authenticated users can read" ON public.categories;
DROP POLICY IF EXISTS "Categories: Committee can create" ON public.categories;
DROP POLICY IF EXISTS "Categories: Committee can update" ON public.categories;
DROP POLICY IF EXISTS "Categories: Committee can archive" ON public.categories;
DROP POLICY IF EXISTS "Organizers can create categories" ON public.categories;

DROP POLICY IF EXISTS "Registrations: Users can read their own" ON public.registrations;
DROP POLICY IF EXISTS "Registrations: Committee can read category entries" ON public.registrations;

DROP POLICY IF EXISTS "Groups: Authenticated users can read" ON public.groups;
DROP POLICY IF EXISTS "Group Members: Authenticated users can read" ON public.group_members;
DROP POLICY IF EXISTS "Matches: Authenticated users can read" ON public.matches;
DROP POLICY IF EXISTS "Match Games: Authenticated users can read" ON public.match_games;
DROP POLICY IF EXISTS "Match Events: Authenticated users can read" ON public.match_events;
DROP POLICY IF EXISTS "Draw previews: Committee can read" ON public.category_draw_previews;
DROP POLICY IF EXISTS "Global rankings: Authenticated users can read" ON public.global_rankings;
DROP POLICY IF EXISTS "Audit logs: Committee can read" ON public.audit_logs;

CREATE POLICY "Profiles: Authenticated directory can read public names"
  ON public.profiles FOR SELECT TO authenticated
  USING (TRUE);

REVOKE ALL ON public.profiles FROM anon, authenticated;
GRANT SELECT (id, full_name, is_community_member, created_at) ON public.profiles TO authenticated;

DROP POLICY IF EXISTS "Tournaments: Allow all users to select" ON public.tournaments;
CREATE POLICY "Tournaments: Authenticated users can read"
  ON public.tournaments FOR SELECT TO authenticated
  USING (TRUE);
CREATE POLICY "Tournaments: Committee can create"
  ON public.tournaments FOR INSERT TO authenticated
  WITH CHECK ((SELECT private.is_committee_member()));
CREATE POLICY "Tournaments: Committee can update"
  ON public.tournaments FOR UPDATE TO authenticated
  USING ((SELECT private.is_committee_member()))
  WITH CHECK ((SELECT private.is_committee_member()));
CREATE POLICY "Tournaments: Committee can archive"
  ON public.tournaments FOR DELETE TO authenticated
  USING ((SELECT private.is_committee_member()));

REVOKE ALL ON public.tournaments FROM anon, authenticated;
GRANT SELECT ON public.tournaments TO authenticated;
GRANT INSERT (title, description, location, court_count, start_date, end_date)
  ON public.tournaments TO authenticated;

DROP POLICY IF EXISTS "Categories: Allow all users to select" ON public.categories;
DROP POLICY IF EXISTS "Organizers can update category status" ON public.categories;
CREATE POLICY "Categories: Authenticated users can read"
  ON public.categories FOR SELECT TO authenticated
  USING (TRUE);
CREATE POLICY "Categories: Committee can create"
  ON public.categories FOR INSERT TO authenticated
  WITH CHECK ((SELECT private.is_committee_member()));
CREATE POLICY "Categories: Committee can update"
  ON public.categories FOR UPDATE TO authenticated
  USING ((SELECT private.is_committee_member()))
  WITH CHECK ((SELECT private.is_committee_member()));
CREATE POLICY "Categories: Committee can archive"
  ON public.categories FOR DELETE TO authenticated
  USING ((SELECT private.is_committee_member()));

REVOKE ALL ON public.categories FROM anon, authenticated;
GRANT SELECT ON public.categories TO authenticated;
GRANT INSERT (tournament_id, name, max_capacity, group_count, qualifiers_per_group, format)
  ON public.categories TO authenticated;

DROP POLICY IF EXISTS "Registrations: Allow users to manage their own registrations" ON public.registrations;
DROP POLICY IF EXISTS "Organizers can view category registrations" ON public.registrations;
CREATE POLICY "Registrations: Users can read their own"
  ON public.registrations FOR SELECT TO authenticated
  USING (player_id = (SELECT auth.uid()));
CREATE POLICY "Registrations: Committee can read category entries"
  ON public.registrations FOR SELECT TO authenticated
  USING ((SELECT private.is_committee_member()));

REVOKE ALL ON public.registrations FROM anon, authenticated;
GRANT SELECT ON public.registrations TO authenticated;

DROP POLICY IF EXISTS "Groups: Allow all users to select" ON public.groups;
CREATE POLICY "Groups: Authenticated users can read"
  ON public.groups FOR SELECT TO authenticated
  USING (TRUE);
REVOKE ALL ON public.groups FROM anon, authenticated;
GRANT SELECT ON public.groups TO authenticated;

DROP POLICY IF EXISTS "Group Members: Allow all users to select" ON public.group_members;
CREATE POLICY "Group Members: Authenticated users can read"
  ON public.group_members FOR SELECT TO authenticated
  USING (TRUE);
REVOKE ALL ON public.group_members FROM anon, authenticated;
GRANT SELECT ON public.group_members TO authenticated;

DROP POLICY IF EXISTS "Organizers can create groups" ON public.groups;
DROP POLICY IF EXISTS "Organizers can create group members" ON public.group_members;
DROP POLICY IF EXISTS "Organizers can create matches" ON public.matches;

DROP POLICY IF EXISTS "Matches: Allow all users to select" ON public.matches;
CREATE POLICY "Matches: Authenticated users can read"
  ON public.matches FOR SELECT TO authenticated
  USING (TRUE);
REVOKE ALL ON public.matches FROM anon, authenticated;
GRANT SELECT ON public.matches TO authenticated;

DROP POLICY IF EXISTS "Match Games: Allow all users to select" ON public.match_games;
CREATE POLICY "Match Games: Authenticated users can read"
  ON public.match_games FOR SELECT TO authenticated
  USING (TRUE);
REVOKE ALL ON public.match_games FROM anon, authenticated;
GRANT SELECT ON public.match_games TO authenticated;

DROP POLICY IF EXISTS "Match Events: Allow all users to select" ON public.match_events;
CREATE POLICY "Match Events: Authenticated users can read"
  ON public.match_events FOR SELECT TO authenticated
  USING (TRUE);
REVOKE ALL ON public.match_events FROM anon, authenticated;
GRANT SELECT ON public.match_events TO authenticated;

CREATE POLICY "Draw previews: Committee can read"
  ON public.category_draw_previews FOR SELECT TO authenticated
  USING ((SELECT private.is_committee_member()));
REVOKE ALL ON public.category_draw_previews FROM anon, authenticated;
GRANT SELECT ON public.category_draw_previews TO authenticated;

CREATE POLICY "Global rankings: Authenticated users can read"
  ON public.global_rankings FOR SELECT TO authenticated
  USING (TRUE);
REVOKE ALL ON public.global_rankings FROM anon, authenticated;
GRANT SELECT ON public.global_rankings TO authenticated;

CREATE POLICY "Audit logs: Committee can read"
  ON public.audit_logs FOR SELECT TO authenticated
  USING ((SELECT private.is_committee_member()));
REVOKE ALL ON public.audit_logs FROM anon, authenticated;
GRANT SELECT ON public.audit_logs TO authenticated;

-- -----------------------------------------------------------------------------
-- Atomic player and committee registration operations
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.register_for_category(
  category_uuid UUID
)
RETURNS public.registration_status
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  player UUID := (SELECT auth.uid());
  category_record public.categories%ROWTYPE;
  existing_registration public.registrations%ROWTYPE;
  confirmed_count INTEGER;
  assigned_status public.registration_status;
BEGIN
  IF player IS NULL THEN
    RAISE EXCEPTION 'Authentication is required.'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = player) THEN
    RAISE EXCEPTION 'Player profile not found.'
      USING ERRCODE = '42501';
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

  IF category_record.status <> 'REGISTRATION_OPEN' THEN
    RAISE EXCEPTION 'Registration is not open for this category.'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT registration.*
  INTO existing_registration
  FROM public.registrations AS registration
  WHERE registration.category_id = category_uuid
    AND registration.player_id = player
  FOR UPDATE;

  IF existing_registration.id IS NOT NULL AND existing_registration.status <> 'WITHDRAWN' THEN
    RAISE EXCEPTION 'You are already registered for this category.'
      USING ERRCODE = '23505';
  END IF;

  SELECT count(*)::INTEGER
  INTO confirmed_count
  FROM public.registrations AS registration
  WHERE registration.category_id = category_uuid
    AND registration.status = 'CONFIRMED';

  assigned_status := CASE
    WHEN confirmed_count < category_record.max_capacity THEN 'CONFIRMED'::public.registration_status
    ELSE 'WAITLISTED'::public.registration_status
  END;

  IF existing_registration.id IS NOT NULL THEN
    UPDATE public.registrations
    SET status = assigned_status,
        created_at = now()
    WHERE id = existing_registration.id;
  ELSE
    INSERT INTO public.registrations (category_id, player_id, status)
    VALUES (category_uuid, player, assigned_status);
  END IF;

  RETURN assigned_status;
END;
$$;

CREATE OR REPLACE FUNCTION public.withdraw_registration(
  registration_uuid UUID
)
RETURNS public.registrations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  player UUID := (SELECT auth.uid());
  registration_record public.registrations%ROWTYPE;
  category_record public.categories%ROWTYPE;
BEGIN
  IF player IS NULL THEN
    RAISE EXCEPTION 'Authentication is required.'
      USING ERRCODE = '42501';
  END IF;

  SELECT registration.*
  INTO registration_record
  FROM public.registrations AS registration
  WHERE registration.id = registration_uuid
    AND registration.player_id = player
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Registration not found.'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT category.*
  INTO category_record
  FROM public.categories AS category
  WHERE category.id = registration_record.category_id;

  IF category_record.status <> 'REGISTRATION_OPEN' THEN
    RAISE EXCEPTION 'Registration can only be withdrawn before registration closes.'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.registrations
  SET status = 'WITHDRAWN'
  WHERE id = registration_uuid
  RETURNING * INTO registration_record;

  RETURN registration_record;
END;
$$;

CREATE OR REPLACE FUNCTION public.promote_next_waitlisted(
  category_uuid UUID
)
RETURNS public.registrations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  category_record public.categories%ROWTYPE;
  next_registration public.registrations%ROWTYPE;
  confirmed_count INTEGER;
BEGIN
  IF NOT (SELECT private.is_committee_member()) THEN
    RAISE EXCEPTION 'Administrator access is required.'
      USING ERRCODE = '42501';
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

  IF category_record.status <> 'REGISTRATION_OPEN' THEN
    RAISE EXCEPTION 'Registration must be open before promoting a waitlisted player.'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*)::INTEGER
  INTO confirmed_count
  FROM public.registrations AS registration
  WHERE registration.category_id = category_uuid
    AND registration.status = 'CONFIRMED';

  IF confirmed_count >= category_record.max_capacity THEN
    RAISE EXCEPTION 'The category is already at capacity.'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT registration.*
  INTO next_registration
  FROM public.registrations AS registration
  WHERE registration.category_id = category_uuid
    AND registration.status = 'WAITLISTED'
  ORDER BY registration.created_at, registration.id
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'There are no waitlisted players to promote.'
      USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.registrations
  SET status = 'CONFIRMED'
  WHERE id = next_registration.id
  RETURNING * INTO next_registration;

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
    'WAITLIST_PROMOTED',
    'registration',
    next_registration.id,
    jsonb_build_object('status', 'WAITLISTED'),
    jsonb_build_object('status', 'CONFIRMED')
  );

  RETURN next_registration;
END;
$$;

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

  SELECT registration.*
  INTO registration_record
  FROM public.registrations AS registration
  WHERE registration.id = registration_uuid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Registration not found.'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT category.*
  INTO category_record
  FROM public.categories AS category
  WHERE category.id = registration_record.category_id
  FOR UPDATE;

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

CREATE OR REPLACE FUNCTION public.set_category_registration_status(
  category_uuid UUID,
  next_status VARCHAR
)
RETURNS VARCHAR
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  category_record public.categories%ROWTYPE;
  confirmed_count INTEGER;
BEGIN
  IF NOT (SELECT private.is_committee_member()) THEN
    RAISE EXCEPTION 'Administrator access is required.'
      USING ERRCODE = '42501';
  END IF;

  IF next_status NOT IN ('REGISTRATION_OPEN', 'REGISTRATION_CLOSED') THEN
    RAISE EXCEPTION 'Unsupported registration status.'
      USING ERRCODE = 'P0001';
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

  IF next_status = 'REGISTRATION_OPEN' THEN
    IF category_record.status NOT IN ('DRAFT', 'REGISTRATION_CLOSED') THEN
      RAISE EXCEPTION 'This category cannot be reopened from its current state.'
        USING ERRCODE = 'P0001';
    END IF;
  ELSE
    IF category_record.status <> 'REGISTRATION_OPEN' THEN
      RAISE EXCEPTION 'Registration is not currently open.'
        USING ERRCODE = 'P0001';
    END IF;

    SELECT count(*)::INTEGER
    INTO confirmed_count
    FROM public.registrations AS registration
    WHERE registration.category_id = category_uuid
      AND registration.status = 'CONFIRMED';

    IF confirmed_count < category_record.group_count THEN
      RAISE EXCEPTION 'At least one confirmed player per group is required before closing registration.'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  UPDATE public.categories
  SET status = next_status::public.tournament_status
  WHERE id = category_uuid;

  PERFORM private.sync_tournament_status(category_uuid);

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
    'CATEGORY_REGISTRATION_STATUS_CHANGED',
    'category',
    category_uuid,
    jsonb_build_object('status', category_record.status),
    jsonb_build_object('status', next_status)
  );

  RETURN next_status;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_tournament_categories(
  tournament_uuid UUID
)
RETURNS TABLE (
  id UUID,
  tournament_id UUID,
  name VARCHAR,
  max_capacity INTEGER,
  group_count INTEGER,
  qualifiers_per_group INTEGER,
  format public.scoring_format,
  status public.tournament_status,
  created_at TIMESTAMP WITH TIME ZONE,
  confirmed_count INTEGER,
  waitlisted_count INTEGER
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Authentication is required.'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    category.id,
    category.tournament_id,
    category.name,
    category.max_capacity,
    category.group_count,
    category.qualifiers_per_group,
    category.format,
    category.status,
    category.created_at,
    count(registration.id) FILTER (WHERE registration.status = 'CONFIRMED')::INTEGER,
    count(registration.id) FILTER (WHERE registration.status = 'WAITLISTED')::INTEGER
  FROM public.categories AS category
  LEFT JOIN public.registrations AS registration
    ON registration.category_id = category.id
  WHERE category.tournament_id = tournament_uuid
  GROUP BY category.id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_tournament_categories(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_tournament_categories(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.register_for_category(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.withdraw_registration(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.promote_next_waitlisted(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_registration_seed(UUID, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_category_registration_status(UUID, VARCHAR) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_for_category(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.withdraw_registration(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.promote_next_waitlisted(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_registration_seed(UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_category_registration_status(UUID, VARCHAR) TO authenticated;

-- -----------------------------------------------------------------------------
-- Private draw preview, publication, and scheduling operations
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.save_category_draw_preview(
  category_uuid UUID,
  groups_payload JSONB
)
RETURNS public.category_draw_previews
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  category_record public.categories%ROWTYPE;
  preview_record public.category_draw_previews%ROWTYPE;
  confirmed_count INTEGER;
  preview_player_count INTEGER;
  preview_distinct_player_count INTEGER;
  matched_player_count INTEGER;
  group_size_difference INTEGER;
  invalid_seed_count INTEGER;
  duplicate_seed_count INTEGER;
  invalid_group_name_count INTEGER;
  duplicate_group_name_count INTEGER;
  match_count INTEGER;
BEGIN
  IF NOT (SELECT private.is_committee_member()) THEN
    RAISE EXCEPTION 'Administrator access is required.'
      USING ERRCODE = '42501';
  END IF;

  IF groups_payload IS NULL OR jsonb_typeof(groups_payload) <> 'array' THEN
    RAISE EXCEPTION 'Draw preview data is invalid.'
      USING ERRCODE = '22023';
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

  IF category_record.status NOT IN ('REGISTRATION_CLOSED', 'DRAW_PREPARATION', 'DRAW_GENERATED') THEN
    RAISE EXCEPTION 'Registration must be closed before generating a draw.'
      USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (SELECT 1 FROM public.groups WHERE category_id = category_uuid) THEN
    RAISE EXCEPTION 'An official draw already exists for this category.'
      USING ERRCODE = '23505';
  END IF;

  SELECT count(*)::INTEGER
  INTO confirmed_count
  FROM public.registrations AS registration
  WHERE registration.category_id = category_uuid
    AND registration.status = 'CONFIRMED';

  IF confirmed_count < category_record.group_count THEN
    RAISE EXCEPTION 'There are not enough confirmed players for the configured groups.'
      USING ERRCODE = 'P0001';
  END IF;

  IF jsonb_array_length(groups_payload) <> category_record.group_count THEN
    RAISE EXCEPTION 'The preview group count does not match the category configuration.'
      USING ERRCODE = '22023';
  END IF;

  WITH preview_groups AS (
    SELECT
      btrim(coalesce(group_payload.value ->> 'name', '')) AS group_name,
      group_payload.value -> 'players' AS players
    FROM jsonb_array_elements(groups_payload) AS group_payload(value)
  )
  SELECT
    count(*) FILTER (
      WHERE group_name = ''
         OR length(group_name) > 50
         OR players IS NULL
         OR jsonb_typeof(players) <> 'array'
    )::INTEGER,
    (count(*) - count(DISTINCT group_name))::INTEGER,
    max(CASE WHEN jsonb_typeof(players) = 'array' THEN jsonb_array_length(players) END)
      - min(CASE WHEN jsonb_typeof(players) = 'array' THEN jsonb_array_length(players) END)
  INTO invalid_group_name_count, duplicate_group_name_count, group_size_difference
  FROM preview_groups;

  IF invalid_group_name_count > 0 OR duplicate_group_name_count > 0 THEN
    RAISE EXCEPTION 'Preview group names must be unique, non-empty, and at most 50 characters.'
      USING ERRCODE = '22023';
  END IF;

  IF group_size_difference IS NULL OR group_size_difference > 1 THEN
    RAISE EXCEPTION 'Group sizes must differ by no more than one player.'
      USING ERRCODE = '22023';
  END IF;

  WITH preview_players AS (
    SELECT (player_payload.value ->> 'id')::UUID AS player_id
    FROM jsonb_array_elements(groups_payload) AS group_payload(value)
    CROSS JOIN LATERAL jsonb_array_elements(group_payload.value -> 'players') AS player_payload(value)
  )
  SELECT
    count(*)::INTEGER,
    count(DISTINCT player_id)::INTEGER
  INTO preview_player_count, preview_distinct_player_count
  FROM preview_players;

  SELECT count(*)::INTEGER
  INTO matched_player_count
  FROM public.registrations AS registration
  WHERE registration.category_id = category_uuid
    AND registration.status = 'CONFIRMED'
    AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements(groups_payload) AS group_payload(value)
      CROSS JOIN LATERAL jsonb_array_elements(group_payload.value -> 'players') AS player_payload(value)
      WHERE (player_payload.value ->> 'id')::UUID = registration.player_id
    );

  IF preview_player_count <> confirmed_count
     OR preview_distinct_player_count <> preview_player_count
     OR matched_player_count <> confirmed_count THEN
    RAISE EXCEPTION 'Every confirmed player must appear exactly once in the preview.'
      USING ERRCODE = '22023';
  END IF;

  WITH preview_seeds AS (
    SELECT (player_payload.value ->> 'seed_number')::INTEGER AS seed_number
    FROM jsonb_array_elements(groups_payload) AS group_payload(value)
    CROSS JOIN LATERAL jsonb_array_elements(group_payload.value -> 'players') AS player_payload(value)
    WHERE player_payload.value ? 'seed_number'
      AND player_payload.value ->> 'seed_number' IS NOT NULL
  )
  SELECT
    count(*) FILTER (WHERE seed_number IS NULL OR seed_number < 1)::INTEGER,
    count(*) - count(DISTINCT seed_number)::INTEGER
  INTO invalid_seed_count, duplicate_seed_count
  FROM preview_seeds;

  IF invalid_seed_count > 0 OR duplicate_seed_count > 0 THEN
    RAISE EXCEPTION 'Preview seed numbers must be positive and unique.'
      USING ERRCODE = '22023';
  END IF;

  SELECT count(*)::INTEGER
  INTO match_count
  FROM jsonb_array_elements(groups_payload) AS group_payload(value)
  CROSS JOIN LATERAL jsonb_array_elements(group_payload.value -> 'players') AS first_player(value)
  CROSS JOIN LATERAL jsonb_array_elements(group_payload.value -> 'players') AS second_player(value)
  WHERE (first_player.value ->> 'id')::UUID < (second_player.value ->> 'id')::UUID;

  INSERT INTO public.category_draw_previews (
    category_id,
    groups_payload,
    matches_count,
    status,
    generated_by,
    generated_at,
    published_by,
    published_at,
    created_at,
    updated_at
  )
  VALUES (
    category_uuid,
    groups_payload,
    match_count,
    'READY',
    (SELECT auth.uid()),
    now(),
    NULL,
    NULL,
    now(),
    now()
  )
  ON CONFLICT (category_id) DO UPDATE
  SET groups_payload = EXCLUDED.groups_payload,
      matches_count = EXCLUDED.matches_count,
      status = 'READY',
      generated_by = EXCLUDED.generated_by,
      generated_at = EXCLUDED.generated_at,
      published_by = NULL,
      published_at = NULL,
      updated_at = now()
  RETURNING * INTO preview_record;

  UPDATE public.categories
  SET status = 'DRAW_GENERATED'
  WHERE id = category_uuid;

  PERFORM private.sync_tournament_status(category_uuid);

  INSERT INTO public.audit_logs (
    actor_id,
    action,
    entity_type,
    entity_id,
    new_data
  )
  VALUES (
    (SELECT auth.uid()),
    'DRAW_PREVIEW_GENERATED',
    'category',
    category_uuid,
    jsonb_build_object('groups', jsonb_array_length(groups_payload), 'matches', match_count)
  );

  RETURN preview_record;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_category_draw_preview(
  category_uuid UUID
)
RETURNS VARCHAR
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_status public.tournament_status;
BEGIN
  IF NOT (SELECT private.is_committee_member()) THEN
    RAISE EXCEPTION 'Administrator access is required.'
      USING ERRCODE = '42501';
  END IF;

  SELECT category.status
  INTO current_status
  FROM public.categories AS category
  WHERE category.id = category_uuid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Category not found.'
      USING ERRCODE = 'P0002';
  END IF;

  IF current_status NOT IN ('DRAW_PREPARATION', 'DRAW_GENERATED') THEN
    RAISE EXCEPTION 'There is no unpublished draw preview to cancel.'
      USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (SELECT 1 FROM public.groups WHERE category_id = category_uuid) THEN
    RAISE EXCEPTION 'An official draw already exists and cannot be cancelled here.'
      USING ERRCODE = '23505';
  END IF;

  DELETE FROM public.category_draw_previews
  WHERE category_id = category_uuid;

  UPDATE public.categories
  SET status = 'REGISTRATION_CLOSED'
  WHERE id = category_uuid;

  PERFORM private.sync_tournament_status(category_uuid);

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
    'DRAW_PREVIEW_CANCELLED',
    'category',
    category_uuid,
    jsonb_build_object('status', current_status),
    jsonb_build_object('status', 'REGISTRATION_CLOSED')
  );

  RETURN 'REGISTRATION_CLOSED';
END;
$$;

CREATE OR REPLACE FUNCTION public.publish_category_draw(
  category_uuid UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  category_record public.categories%ROWTYPE;
  preview_record public.category_draw_previews%ROWTYPE;
  group_payload JSONB;
  player_payload JSONB;
  created_group_id UUID;
  created_match_count INTEGER;
BEGIN
  IF NOT (SELECT private.is_committee_member()) THEN
    RAISE EXCEPTION 'Administrator access is required.'
      USING ERRCODE = '42501';
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

  IF category_record.status <> 'DRAW_GENERATED' THEN
    RAISE EXCEPTION 'Generate and review a draw preview before publishing.'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT preview.*
  INTO preview_record
  FROM public.category_draw_previews AS preview
  WHERE preview.category_id = category_uuid
    AND preview.status = 'READY'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No draw preview is ready to publish.'
      USING ERRCODE = 'P0002';
  END IF;

  IF EXISTS (SELECT 1 FROM public.groups WHERE category_id = category_uuid) THEN
    RAISE EXCEPTION 'An official draw already exists for this category.'
      USING ERRCODE = '23505';
  END IF;

  FOR group_payload IN
    SELECT value
    FROM jsonb_array_elements(preview_record.groups_payload)
  LOOP
    INSERT INTO public.groups (category_id, name)
    VALUES (category_uuid, group_payload ->> 'name')
    RETURNING id INTO created_group_id;

    FOR player_payload IN
      SELECT value
      FROM jsonb_array_elements(group_payload -> 'players')
    LOOP
      INSERT INTO public.group_members (group_id, player_id)
      VALUES (created_group_id, (player_payload ->> 'id')::UUID);
    END LOOP;
  END LOOP;

  INSERT INTO public.matches (
    category_id,
    group_id,
    player_a_id,
    player_b_id,
    status
  )
  SELECT
    group_record.category_id,
    group_record.id,
    first_member.player_id,
    second_member.player_id,
    'SCHEDULED'
  FROM public.groups AS group_record
  JOIN public.group_members AS first_member
    ON first_member.group_id = group_record.id
  JOIN public.group_members AS second_member
    ON second_member.group_id = group_record.id
   AND first_member.player_id < second_member.player_id
  WHERE group_record.category_id = category_uuid;

  GET DIAGNOSTICS created_match_count = ROW_COUNT;

  IF created_match_count <> preview_record.matches_count THEN
    RAISE EXCEPTION 'The generated match count does not match the approved preview.'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.category_draw_previews
  SET status = 'PUBLISHED',
      published_by = (SELECT auth.uid()),
      published_at = now(),
      updated_at = now()
  WHERE id = preview_record.id;

  UPDATE public.categories
  SET status = 'DRAW_PUBLISHED'
  WHERE id = category_uuid;

  PERFORM private.sync_tournament_status(category_uuid);

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
    'DRAW_PUBLISHED',
    'category',
    category_uuid,
    jsonb_build_object('status', category_record.status),
    jsonb_build_object('status', 'DRAW_PUBLISHED', 'matches', created_match_count)
  );

  RETURN created_match_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.assign_match_officials(
  match_uuid UUID,
  umpire_uuid UUID,
  linesman_uuid UUID
)
RETURNS TABLE (
  id UUID,
  umpire_id UUID,
  linesman_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  match_record public.matches%ROWTYPE;
  tournament_id UUID;
  scheduled_start TIMESTAMP WITH TIME ZONE;
BEGIN
  IF NOT (SELECT private.is_committee_member()) THEN
    RAISE EXCEPTION 'Administrator access is required.'
      USING ERRCODE = '42501';
  END IF;

  IF umpire_uuid IS NOT NULL AND umpire_uuid = linesman_uuid THEN
    RAISE EXCEPTION 'Choose different people for umpire and linesman.'
      USING ERRCODE = '22023';
  END IF;

  SELECT match.*
  INTO match_record
  FROM public.matches AS match
  WHERE match.id = match_uuid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Match not found.'
      USING ERRCODE = 'P0002';
  END IF;

  IF match_record.status <> 'SCHEDULED' THEN
    RAISE EXCEPTION 'Officials can only be changed before a match begins.'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT category.tournament_id
  INTO tournament_id
  FROM public.categories AS category
  WHERE category.id = match_record.category_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tournament not found.'
      USING ERRCODE = 'P0002';
  END IF;

  IF umpire_uuid IN (match_record.player_a_id, match_record.player_b_id)
     OR linesman_uuid IN (match_record.player_a_id, match_record.player_b_id) THEN
    RAISE EXCEPTION 'A player cannot officiate their own match.'
      USING ERRCODE = '22023';
  END IF;

  IF umpire_uuid IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.profiles AS profile
    WHERE profile.id = umpire_uuid AND (profile.is_admin = TRUE OR profile.is_community_member = TRUE)
  ) THEN
    RAISE EXCEPTION 'The selected umpire is not on the officials roster.'
      USING ERRCODE = '22023';
  END IF;

  IF linesman_uuid IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.profiles AS profile
    WHERE profile.id = linesman_uuid AND (profile.is_admin = TRUE OR profile.is_community_member = TRUE)
  ) THEN
    RAISE EXCEPTION 'The selected linesman is not on the officials roster.'
      USING ERRCODE = '22023';
  END IF;

  -- Serialize schedule/official mutations so cross-category resource checks see committed state.
  PERFORM pg_advisory_xact_lock(hashtextextended('umpsace:match-scheduling', 0));
  scheduled_start := match_record.scheduled_time;

  IF scheduled_start IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM public.matches AS other_match
      WHERE other_match.id <> match_record.id
        AND other_match.status NOT IN ('CANCELLED', 'POSTPONED')
        AND other_match.scheduled_time IS NOT NULL
        AND (
          other_match.umpire_id = umpire_uuid
          OR other_match.linesman_id = umpire_uuid
          OR other_match.umpire_id = linesman_uuid
          OR other_match.linesman_id = linesman_uuid
        )
        AND tstzrange(other_match.scheduled_time, other_match.scheduled_time + INTERVAL '40 minutes', '[)')
          && tstzrange(scheduled_start, scheduled_start + INTERVAL '40 minutes', '[)')
    ) THEN
      RAISE EXCEPTION 'An assigned official is already officiating at this time.'
        USING ERRCODE = 'P0001';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.matches AS other_match
      WHERE other_match.id <> match_record.id
        AND other_match.status NOT IN ('CANCELLED', 'POSTPONED')
        AND other_match.scheduled_time IS NOT NULL
        AND (
          (other_match.umpire_id IN (match_record.player_a_id, match_record.player_b_id)
            AND abs(extract(epoch FROM (other_match.scheduled_time - scheduled_start))) < 70 * 60)
          OR
          (other_match.linesman_id IN (match_record.player_a_id, match_record.player_b_id)
            AND abs(extract(epoch FROM (other_match.scheduled_time - scheduled_start))) < 70 * 60)
          OR
          (umpire_uuid IN (other_match.player_a_id, other_match.player_b_id)
            AND abs(extract(epoch FROM (other_match.scheduled_time - scheduled_start))) < 70 * 60)
          OR
          (linesman_uuid IN (other_match.player_a_id, other_match.player_b_id)
            AND abs(extract(epoch FROM (other_match.scheduled_time - scheduled_start))) < 70 * 60)
        )
    ) THEN
      RAISE EXCEPTION 'The player and official assignments do not meet the required time buffer.'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  UPDATE public.matches AS match
  SET umpire_id = umpire_uuid,
      linesman_id = linesman_uuid
  WHERE match.id = match_uuid;

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
    'MATCH_OFFICIALS_ASSIGNED',
    'match',
    match_uuid,
    jsonb_build_object('umpire_id', match_record.umpire_id, 'linesman_id', match_record.linesman_id),
    jsonb_build_object('umpire_id', umpire_uuid, 'linesman_id', linesman_uuid)
  );

  RETURN QUERY
  SELECT match_record.id, umpire_uuid, linesman_uuid;
END;
$$;

CREATE OR REPLACE FUNCTION public.schedule_match(
  match_uuid UUID,
  court_value INTEGER,
  start_time TIMESTAMP WITH TIME ZONE,
  umpire_uuid UUID,
  linesman_uuid UUID
)
RETURNS TABLE (
  id UUID,
  court_number INTEGER,
  scheduled_time TIMESTAMP WITH TIME ZONE,
  estimated_start_time TIMESTAMP WITH TIME ZONE
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  match_record public.matches%ROWTYPE;
  tournament_record public.tournaments%ROWTYPE;
BEGIN
  IF NOT (SELECT private.is_committee_member()) THEN
    RAISE EXCEPTION 'Administrator access is required.'
      USING ERRCODE = '42501';
  END IF;

  IF start_time IS NULL OR court_value IS NULL OR court_value < 1 OR umpire_uuid = linesman_uuid THEN
    RAISE EXCEPTION 'Court and official assignments are invalid.'
      USING ERRCODE = '22023';
  END IF;

  SELECT match.*
  INTO match_record
  FROM public.matches AS match
  WHERE match.id = match_uuid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Match not found.'
      USING ERRCODE = 'P0002';
  END IF;

  IF match_record.status <> 'SCHEDULED' THEN
    RAISE EXCEPTION 'Ready, active, and completed match allocations are locked.'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT tournament.*
  INTO tournament_record
  FROM public.tournaments AS tournament
  JOIN public.categories AS category ON category.tournament_id = tournament.id
  WHERE category.id = match_record.category_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tournament not found.'
      USING ERRCODE = 'P0002';
  END IF;

  IF court_value > tournament_record.court_count THEN
    RAISE EXCEPTION 'Court number exceeds the tournament court count.'
      USING ERRCODE = '22023';
  END IF;

  IF start_time < tournament_record.start_date
     OR start_time + INTERVAL '40 minutes' > tournament_record.end_date THEN
    RAISE EXCEPTION 'Match time and its 40-minute block must fall within the tournament dates.'
      USING ERRCODE = '22023';
  END IF;

  IF umpire_uuid IN (match_record.player_a_id, match_record.player_b_id)
     OR linesman_uuid IN (match_record.player_a_id, match_record.player_b_id) THEN
    RAISE EXCEPTION 'A player cannot officiate their own match.'
      USING ERRCODE = '22023';
  END IF;

  IF umpire_uuid IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.profiles AS profile
    WHERE profile.id = umpire_uuid AND (profile.is_admin = TRUE OR profile.is_community_member = TRUE)
  ) THEN
    RAISE EXCEPTION 'The selected umpire is not on the officials roster.'
      USING ERRCODE = '22023';
  END IF;

  IF linesman_uuid IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.profiles AS profile
    WHERE profile.id = linesman_uuid AND (profile.is_admin = TRUE OR profile.is_community_member = TRUE)
  ) THEN
    RAISE EXCEPTION 'The selected linesman is not on the officials roster.'
      USING ERRCODE = '22023';
  END IF;

  -- Serialize schedule/official mutations so cross-category resource checks see committed state.
  PERFORM pg_advisory_xact_lock(hashtextextended('umpsace:match-scheduling', 0));

  IF EXISTS (
    SELECT 1
    FROM public.matches AS other_match
    WHERE other_match.category_id IN (
        SELECT category.id
        FROM public.categories AS category
        WHERE category.tournament_id = tournament_record.id
      )
      AND other_match.id <> match_record.id
      AND other_match.status NOT IN ('CANCELLED', 'POSTPONED')
      AND other_match.court_number = court_value
      AND other_match.scheduled_time IS NOT NULL
      AND tstzrange(other_match.scheduled_time, other_match.scheduled_time + INTERVAL '40 minutes', '[)')
        && tstzrange(start_time, start_time + INTERVAL '40 minutes', '[)')
  ) THEN
    RAISE EXCEPTION 'The selected court is already occupied at this time.'
      USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.matches AS other_match
    WHERE other_match.id <> match_record.id
      AND other_match.status NOT IN ('CANCELLED', 'POSTPONED')
      AND other_match.scheduled_time IS NOT NULL
      AND (
        other_match.player_a_id IN (match_record.player_a_id, match_record.player_b_id)
        OR other_match.player_b_id IN (match_record.player_a_id, match_record.player_b_id)
      )
      AND NOT (
        start_time + INTERVAL '60 minutes' <= other_match.scheduled_time
        OR other_match.scheduled_time + INTERVAL '60 minutes' <= start_time
      )
  ) THEN
    RAISE EXCEPTION 'A competitor is double-booked or does not have enough rest.'
      USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.matches AS other_match
    WHERE other_match.id <> match_record.id
      AND other_match.status NOT IN ('CANCELLED', 'POSTPONED')
      AND other_match.scheduled_time IS NOT NULL
      AND (
        other_match.umpire_id = umpire_uuid
        OR other_match.linesman_id = umpire_uuid
        OR other_match.umpire_id = linesman_uuid
        OR other_match.linesman_id = linesman_uuid
      )
      AND tstzrange(other_match.scheduled_time, other_match.scheduled_time + INTERVAL '40 minutes', '[)')
        && tstzrange(start_time, start_time + INTERVAL '40 minutes', '[)')
  ) THEN
    RAISE EXCEPTION 'An assigned official is already officiating at this time.'
      USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.matches AS other_match
    WHERE other_match.id <> match_record.id
      AND other_match.status NOT IN ('CANCELLED', 'POSTPONED')
      AND other_match.scheduled_time IS NOT NULL
      AND (
        (other_match.umpire_id IN (match_record.player_a_id, match_record.player_b_id)
          AND abs(extract(epoch FROM (other_match.scheduled_time - start_time))) < 70 * 60)
        OR (other_match.linesman_id IN (match_record.player_a_id, match_record.player_b_id)
          AND abs(extract(epoch FROM (other_match.scheduled_time - start_time))) < 70 * 60)
        OR (umpire_uuid IN (other_match.player_a_id, other_match.player_b_id)
          AND abs(extract(epoch FROM (other_match.scheduled_time - start_time))) < 70 * 60)
        OR (linesman_uuid IN (other_match.player_a_id, other_match.player_b_id)
          AND abs(extract(epoch FROM (other_match.scheduled_time - start_time))) < 70 * 60)
      )
  ) THEN
    RAISE EXCEPTION 'The player and official assignments do not meet the required time buffer.'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.matches AS match
  SET court_number = court_value,
      scheduled_time = start_time,
      estimated_start_time = start_time,
      umpire_id = umpire_uuid,
      linesman_id = linesman_uuid
  WHERE match.id = match_uuid;

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
    'MATCH_SCHEDULED',
    'match',
    match_uuid,
    jsonb_build_object(
      'court_number', match_record.court_number,
      'scheduled_time', match_record.scheduled_time,
      'umpire_id', match_record.umpire_id,
      'linesman_id', match_record.linesman_id
    ),
    jsonb_build_object(
      'court_number', court_value,
      'scheduled_time', start_time,
      'umpire_id', umpire_uuid,
      'linesman_id', linesman_uuid
    )
  );

  RETURN QUERY SELECT match_uuid, court_value, start_time, start_time;
END;
$$;

REVOKE ALL ON FUNCTION public.save_category_draw_preview(UUID, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_category_draw_preview(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.publish_category_draw(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assign_match_officials(UUID, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.schedule_match(UUID, INTEGER, TIMESTAMP WITH TIME ZONE, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_category_draw_preview(UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_category_draw_preview(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.publish_category_draw(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assign_match_officials(UUID, UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.schedule_match(UUID, INTEGER, TIMESTAMP WITH TIME ZONE, UUID, UUID) TO authenticated;

-- -----------------------------------------------------------------------------
-- Ranking publication
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.process_tournament_rankings(tournament_uuid UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  tournament_record public.tournaments%ROWTYPE;
  match_record public.matches%ROWTYPE;
  player_id UUID;
  set_wins INTEGER;
  points_won INTEGER;
  points_lost INTEGER;
  win_bonus INTEGER;
  participation_bonus INTEGER;
  ranking_delta INTEGER;
  net_delta INTEGER;
BEGIN
  SELECT tournament.*
  INTO tournament_record
  FROM public.tournaments AS tournament
  WHERE tournament.id = tournament_uuid
  FOR UPDATE;

  IF NOT FOUND OR tournament_record.status <> 'COMPLETED' THEN
    RAISE EXCEPTION 'Only a completed tournament can publish rankings.'
      USING ERRCODE = 'P0001';
  END IF;

  IF tournament_record.rankings_processed_at IS NOT NULL THEN
    RETURN;
  END IF;

  FOR match_record IN
    SELECT match.*
    FROM public.matches AS match
    JOIN public.categories AS category ON category.id = match.category_id
    WHERE category.tournament_id = tournament_uuid
      AND match.status IN ('COMPLETED', 'WALKOVER', 'RETIRED')
      AND match.winner_id IS NOT NULL
  LOOP
    FOR player_id IN
      SELECT player_id
      FROM (
        SELECT match_record.player_a_id AS player_id
        UNION ALL
        SELECT match_record.player_b_id AS player_id
      ) AS participants
    LOOP
      SELECT
        count(*) FILTER (
          WHERE (player_id = match_record.player_a_id AND game.player_a_score > game.player_b_score)
             OR (player_id = match_record.player_b_id AND game.player_b_score > game.player_a_score)
        ),
        coalesce(sum(CASE WHEN player_id = match_record.player_a_id THEN game.player_a_score ELSE game.player_b_score END), 0),
        coalesce(sum(CASE WHEN player_id = match_record.player_a_id THEN game.player_b_score ELSE game.player_a_score END), 0)
      INTO set_wins, points_won, points_lost
      FROM public.match_games AS game
      WHERE game.match_id = match_record.id;

      IF set_wins = 0 AND match_record.status = 'WALKOVER' AND player_id = match_record.winner_id THEN
        set_wins := CASE
          WHEN EXISTS (
            SELECT 1 FROM public.categories AS category
            JOIN public.matches AS match ON match.category_id = category.id
            WHERE match.id = match_record.id
              AND category.format = 'STANDARD_3X21'
          ) THEN 2 ELSE 1
        END;
      END IF;

      win_bonus := CASE WHEN player_id = match_record.winner_id THEN 3 ELSE 0 END;
      participation_bonus := CASE
        WHEN match_record.status = 'WALKOVER' AND player_id <> match_record.winner_id THEN 0
        ELSE 1
      END;
      ranking_delta := win_bonus + participation_bonus + set_wins;
      net_delta := points_won - points_lost;

      INSERT INTO public.global_rankings (
        profile_id, ranking_points, net_points, matches_won, matches_played
      )
      VALUES (
        player_id,
        ranking_delta,
        net_delta,
        CASE WHEN player_id = match_record.winner_id THEN 1 ELSE 0 END,
        1
      )
      ON CONFLICT (profile_id) DO UPDATE
      SET ranking_points = public.global_rankings.ranking_points + EXCLUDED.ranking_points,
          net_points = public.global_rankings.net_points + EXCLUDED.net_points,
          matches_won = public.global_rankings.matches_won + EXCLUDED.matches_won,
          matches_played = public.global_rankings.matches_played + EXCLUDED.matches_played,
          updated_at = now();
    END LOOP;
  END LOOP;

  UPDATE public.tournaments
  SET rankings_processed_at = now()
  WHERE id = tournament_uuid;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_global_rankings()
RETURNS TABLE (
  rank_position BIGINT,
  profile_id UUID,
  full_name VARCHAR,
  ranking_points INTEGER,
  net_points INTEGER,
  matches_won INTEGER,
  matches_played INTEGER
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Authentication is required.'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    dense_rank() OVER (
      ORDER BY ranking.ranking_points DESC, ranking.net_points DESC, ranking.matches_won DESC
    ) AS rank_position,
    ranking.profile_id,
    profile.full_name,
    ranking.ranking_points,
    ranking.net_points,
    ranking.matches_won,
    ranking.matches_played
  FROM public.global_rankings AS ranking
  JOIN public.profiles AS profile ON profile.id = ranking.profile_id
  ORDER BY ranking.ranking_points DESC, ranking.net_points DESC, ranking.matches_won DESC, profile.full_name;
END;
$$;

-- -----------------------------------------------------------------------------
-- Tournament completion and archival
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.sync_tournament_status(category_uuid UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  tournament_uuid UUID;
  category_states public.tournament_status[];
  next_state public.tournament_status;
BEGIN
  SELECT category.tournament_id
  INTO tournament_uuid
  FROM public.categories AS category
  WHERE category.id = category_uuid;

  IF tournament_uuid IS NULL THEN
    RETURN;
  END IF;

  SELECT array_agg(category.status ORDER BY category.created_at)
  INTO category_states
  FROM public.categories AS category
  WHERE category.tournament_id = tournament_uuid;

  next_state := CASE
    WHEN cardinality(category_states) = 0 THEN 'DRAFT'::public.tournament_status
    WHEN category_states <@ ARRAY['COMPLETED'::public.tournament_status] THEN 'COMPLETED'::public.tournament_status
    WHEN category_states <@ ARRAY[
      'GROUP_STAGE_COMPLETED'::public.tournament_status,
      'COMPLETED'::public.tournament_status
    ] AND 'GROUP_STAGE_COMPLETED'::public.tournament_status = ANY(category_states)
      THEN 'GROUP_STAGE_COMPLETED'::public.tournament_status
    WHEN category_states <@ ARRAY[
      'KNOCKOUT_IN_PROGRESS'::public.tournament_status,
      'COMPLETED'::public.tournament_status
    ] AND 'KNOCKOUT_IN_PROGRESS'::public.tournament_status = ANY(category_states)
      THEN 'KNOCKOUT_IN_PROGRESS'::public.tournament_status
    WHEN category_states <@ ARRAY[
      'GROUP_STAGE_IN_PROGRESS'::public.tournament_status,
      'GROUP_STAGE_COMPLETED'::public.tournament_status,
      'KNOCKOUT_IN_PROGRESS'::public.tournament_status,
      'COMPLETED'::public.tournament_status
    ] AND (
      'GROUP_STAGE_IN_PROGRESS'::public.tournament_status = ANY(category_states)
      OR 'GROUP_STAGE_COMPLETED'::public.tournament_status = ANY(category_states)
      OR 'KNOCKOUT_IN_PROGRESS'::public.tournament_status = ANY(category_states)
    ) THEN 'GROUP_STAGE_IN_PROGRESS'::public.tournament_status
    WHEN category_states <@ ARRAY[
      'DRAW_PUBLISHED'::public.tournament_status,
      'GROUP_STAGE_IN_PROGRESS'::public.tournament_status,
      'GROUP_STAGE_COMPLETED'::public.tournament_status,
      'KNOCKOUT_IN_PROGRESS'::public.tournament_status,
      'COMPLETED'::public.tournament_status
    ] THEN 'DRAW_PUBLISHED'::public.tournament_status
    WHEN category_states <@ ARRAY[
      'DRAW_GENERATED'::public.tournament_status,
      'DRAW_PUBLISHED'::public.tournament_status,
      'GROUP_STAGE_IN_PROGRESS'::public.tournament_status,
      'GROUP_STAGE_COMPLETED'::public.tournament_status,
      'KNOCKOUT_IN_PROGRESS'::public.tournament_status,
      'COMPLETED'::public.tournament_status
    ] THEN 'DRAW_GENERATED'::public.tournament_status
    WHEN category_states <@ ARRAY[
      'REGISTRATION_CLOSED'::public.tournament_status,
      'DRAW_PREPARATION'::public.tournament_status,
      'DRAW_GENERATED'::public.tournament_status,
      'DRAW_PUBLISHED'::public.tournament_status,
      'GROUP_STAGE_IN_PROGRESS'::public.tournament_status,
      'GROUP_STAGE_COMPLETED'::public.tournament_status,
      'KNOCKOUT_IN_PROGRESS'::public.tournament_status,
      'COMPLETED'::public.tournament_status
    ] THEN 'REGISTRATION_CLOSED'::public.tournament_status
    WHEN 'REGISTRATION_OPEN'::public.tournament_status = ANY(category_states)
         AND NOT ('DRAFT'::public.tournament_status = ANY(category_states))
      THEN 'REGISTRATION_OPEN'::public.tournament_status
    WHEN category_states <@ ARRAY['DRAFT'::public.tournament_status, 'REGISTRATION_OPEN'::public.tournament_status]
         AND 'REGISTRATION_OPEN'::public.tournament_status = ANY(category_states)
      THEN 'REGISTRATION_OPEN'::public.tournament_status
    WHEN category_states <@ ARRAY['DRAFT'::public.tournament_status] THEN 'DRAFT'::public.tournament_status
    ELSE 'DRAFT'::public.tournament_status
  END;

  UPDATE public.tournaments
  SET status = next_state
  WHERE id = tournament_uuid
    AND status NOT IN ('ARCHIVED', 'COMPLETED');
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_tournament(tournament_uuid UUID)
RETURNS VARCHAR
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor UUID := (SELECT auth.uid());
  tournament_record public.tournaments%ROWTYPE;
  category_record public.categories%ROWTYPE;
  incomplete_count INTEGER;
BEGIN
  IF actor IS NULL OR NOT (SELECT private.is_committee_member()) THEN
    RAISE EXCEPTION 'Administrator access is required.'
      USING ERRCODE = '42501';
  END IF;

  SELECT tournament.*
  INTO tournament_record
  FROM public.tournaments AS tournament
  WHERE tournament.id = tournament_uuid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tournament not found.'
      USING ERRCODE = 'P0002';
  END IF;

  IF tournament_record.status = 'ARCHIVED' THEN
    RAISE EXCEPTION 'An archived tournament cannot be completed again.'
      USING ERRCODE = 'P0001';
  END IF;

  IF tournament_record.status = 'COMPLETED' THEN
    PERFORM private.process_tournament_rankings(tournament_uuid);
    RETURN 'COMPLETED';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.categories WHERE tournament_id = tournament_uuid
  ) THEN
    RAISE EXCEPTION 'A tournament must have at least one category before completion.'
      USING ERRCODE = 'P0001';
  END IF;

  FOR category_record IN
    SELECT category.*
    FROM public.categories AS category
    WHERE category.tournament_id = tournament_uuid
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.matches WHERE category_id = category_record.id
    ) THEN
      RAISE EXCEPTION 'Every category must have published matches before completion.'
        USING ERRCODE = 'P0001';
    END IF;

    SELECT count(*)
    INTO incomplete_count
    FROM public.matches
    WHERE category_id = category_record.id
      AND status NOT IN ('COMPLETED', 'WALKOVER', 'RETIRED');

    IF incomplete_count > 0 THEN
      RAISE EXCEPTION 'All matches must be finalized before tournament completion.'
        USING ERRCODE = 'P0001';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.matches
      WHERE category_id = category_record.id
        AND status IN ('COMPLETED', 'WALKOVER', 'RETIRED')
        AND winner_id IS NULL
    ) THEN
      RAISE EXCEPTION 'Every finalized match must have a winner before tournament completion.'
        USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.categories
    SET status = 'COMPLETED'
    WHERE id = category_record.id;
  END LOOP;

  UPDATE public.tournaments
  SET status = 'COMPLETED'
  WHERE id = tournament_uuid;

  PERFORM private.process_tournament_rankings(tournament_uuid);

  INSERT INTO public.audit_logs (
    actor_id, action, entity_type, entity_id, new_data
  )
  VALUES (
    actor,
    'TOURNAMENT_COMPLETED',
    'tournament',
    tournament_uuid,
    jsonb_build_object('status', 'COMPLETED')
  );

  RETURN 'COMPLETED';
END;
$$;

CREATE OR REPLACE FUNCTION public.archive_tournament(tournament_uuid UUID)
RETURNS VARCHAR
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor UUID := (SELECT auth.uid());
  current_status public.tournament_status;
BEGIN
  IF actor IS NULL OR NOT (SELECT private.is_committee_member()) THEN
    RAISE EXCEPTION 'Administrator access is required.'
      USING ERRCODE = '42501';
  END IF;

  SELECT tournament.status
  INTO current_status
  FROM public.tournaments AS tournament
  WHERE tournament.id = tournament_uuid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tournament not found.'
      USING ERRCODE = 'P0002';
  END IF;

  IF current_status <> 'COMPLETED' THEN
    RAISE EXCEPTION 'Only a completed tournament can be archived.'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.tournaments
  SET status = 'ARCHIVED'
  WHERE id = tournament_uuid;

  INSERT INTO public.audit_logs (
    actor_id, action, entity_type, entity_id, original_data, new_data
  )
  VALUES (
    actor,
    'TOURNAMENT_ARCHIVED',
    'tournament',
    tournament_uuid,
    jsonb_build_object('status', current_status),
    jsonb_build_object('status', 'ARCHIVED')
  );

  RETURN 'ARCHIVED';
END;
$$;

REVOKE ALL ON FUNCTION private.sync_tournament_status(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.process_tournament_rankings(UUID) FROM PUBLIC;

-- Older remote drafts exposed a duplicate profile trigger helper in public.
-- The active trigger uses private.handle_new_user; remove the unused duplicate.
DROP FUNCTION IF EXISTS public.handle_new_user();

-- Supabase installs default EXECUTE grants for Data API roles. Explicitly
-- remove them from exposed SECURITY DEFINER functions; only authenticated
-- callers (and the trusted service role) may invoke these RPCs.
REVOKE ALL ON FUNCTION public.current_user_profile() FROM anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_list_profiles() FROM anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.available_officials() FROM anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.set_community_membership(UUID, BOOLEAN) FROM anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_tournament_categories(UUID) FROM anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.register_for_category(UUID) FROM anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.withdraw_registration(UUID) FROM anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.promote_next_waitlisted(UUID) FROM anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.set_registration_seed(UUID, INTEGER) FROM anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.set_category_registration_status(UUID, VARCHAR) FROM anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.save_category_draw_preview(UUID, JSONB) FROM anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cancel_category_draw_preview(UUID) FROM anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.publish_category_draw(UUID) FROM anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.assign_match_officials(UUID, UUID, UUID) FROM anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.schedule_match(UUID, INTEGER, TIMESTAMP WITH TIME ZONE, UUID, UUID) FROM anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_global_rankings() FROM anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.complete_tournament(UUID) FROM anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.archive_tournament(UUID) FROM anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.current_user_profile() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_profiles() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.available_officials() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_community_membership(UUID, BOOLEAN) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_tournament_categories(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.register_for_category(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.withdraw_registration(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.promote_next_waitlisted(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_registration_seed(UUID, INTEGER) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_category_registration_status(UUID, VARCHAR) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_category_draw_preview(UUID, JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_category_draw_preview(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.publish_category_draw(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.assign_match_officials(UUID, UUID, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.schedule_match(UUID, INTEGER, TIMESTAMP WITH TIME ZONE, UUID, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_global_rankings() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.complete_tournament(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.archive_tournament(UUID) TO authenticated, service_role;
