-- Terminal tournament and registration integrity guards.
--
-- These guards protect the existing committee workflow without making unresolved
-- assumptions about singleton groups, byes, or knockout progression.

-- Category creation is a committee operation with validation at the database
-- boundary. The application action uses this RPC instead of direct inserts.
CREATE OR REPLACE FUNCTION public.create_tournament_category(
  tournament_uuid UUID,
  category_name TEXT,
  category_capacity INTEGER,
  category_group_count INTEGER,
  category_qualifier_count INTEGER,
  category_format public.scoring_format
)
RETURNS public.categories
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  created_category public.categories;
  parent_status public.tournament_status;
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT (SELECT private.is_committee_member()) THEN
    RAISE EXCEPTION 'Administrator access is required.'
      USING ERRCODE = '42501';
  END IF;

  SELECT tournament.status
  INTO parent_status
  FROM public.tournaments AS tournament
  WHERE tournament.id = tournament_uuid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tournament not found.'
      USING ERRCODE = 'P0002';
  END IF;

  IF parent_status IN ('COMPLETED', 'ARCHIVED') THEN
    RAISE EXCEPTION 'Completed and archived tournaments are read-only.'
      USING ERRCODE = 'P0001';
  END IF;

  IF category_name IS NULL
     OR char_length(btrim(category_name)) NOT BETWEEN 2 AND 255 THEN
    RAISE EXCEPTION 'Category name must contain between 2 and 255 characters.'
      USING ERRCODE = '22023';
  END IF;

  IF category_capacity NOT BETWEEN 4 AND 1000
     OR category_group_count NOT BETWEEN 1 AND 64
     OR category_qualifier_count NOT BETWEEN 1 AND 64
     OR category_capacity < category_group_count
     OR category_qualifier_count > floor(category_capacity::numeric / category_group_count::numeric) THEN
    RAISE EXCEPTION 'Category capacity, groups, and qualifiers are invalid.'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.categories (
    tournament_id,
    name,
    max_capacity,
    group_count,
    qualifiers_per_group,
    format
  )
  VALUES (
    tournament_uuid,
    btrim(category_name),
    category_capacity,
    category_group_count,
    category_qualifier_count,
    category_format
  )
  RETURNING * INTO created_category;

  INSERT INTO public.audit_logs (
    actor_id, action, entity_type, entity_id, new_data
  )
  VALUES (
    (SELECT auth.uid()),
    'CATEGORY_CREATED',
    'category',
    created_category.id,
    jsonb_build_object(
      'tournament_id', created_category.tournament_id,
      'name', created_category.name,
      'max_capacity', created_category.max_capacity,
      'group_count', created_category.group_count,
      'qualifiers_per_group', created_category.qualifiers_per_group,
      'format', created_category.format
    )
  );

  RETURN created_category;
END;
$$;

REVOKE ALL ON FUNCTION public.create_tournament_category(UUID, TEXT, INTEGER, INTEGER, INTEGER, public.scoring_format) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_tournament_category(UUID, TEXT, INTEGER, INTEGER, INTEGER, public.scoring_format) TO authenticated;

-- Remove direct category inserts so all committee-created categories pass
-- through the validated RPC. Reads and the existing status/lifecycle RPCs are
-- unchanged.
REVOKE INSERT ON public.categories FROM authenticated;
REVOKE INSERT (tournament_id, name, max_capacity, group_count, qualifiers_per_group, format, status)
  ON public.categories FROM authenticated;

-- Keep category setup values within the bounds already enforced by the app.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'categories_name_not_blank'
      AND conrelid = 'public.categories'::regclass
  ) THEN
    ALTER TABLE public.categories
      ADD CONSTRAINT categories_name_not_blank CHECK (btrim(name) <> '');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'categories_capacity_group_order'
      AND conrelid = 'public.categories'::regclass
  ) THEN
    ALTER TABLE public.categories
      ADD CONSTRAINT categories_capacity_group_order CHECK (max_capacity >= group_count);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'categories_group_count_bounds'
      AND conrelid = 'public.categories'::regclass
  ) THEN
    ALTER TABLE public.categories
      ADD CONSTRAINT categories_group_count_bounds CHECK (group_count BETWEEN 1 AND 64);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'categories_capacity_bounds'
      AND conrelid = 'public.categories'::regclass
  ) THEN
    ALTER TABLE public.categories
      ADD CONSTRAINT categories_capacity_bounds CHECK (max_capacity BETWEEN 1 AND 1000);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'categories_qualifier_bounds'
      AND conrelid = 'public.categories'::regclass
  ) THEN
    ALTER TABLE public.categories
      ADD CONSTRAINT categories_qualifier_bounds CHECK (
        qualifiers_per_group BETWEEN 1 AND 64
        AND qualifiers_per_group <= floor(max_capacity::numeric / group_count::numeric)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'category_draw_previews_positive_matches'
      AND conrelid = 'public.category_draw_previews'::regclass
  ) THEN
    ALTER TABLE public.category_draw_previews
      ADD CONSTRAINT category_draw_previews_positive_matches CHECK (
        status NOT IN ('READY', 'PUBLISHED') OR matches_count > 0
      );
  END IF;
END;
$$;

-- A completed or archived tournament must not accept new category structure or
-- category lifecycle changes. The trigger covers both direct table writes and
-- SECURITY DEFINER RPCs.
CREATE OR REPLACE FUNCTION private.guard_active_tournament_category()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  parent_status public.tournament_status;
BEGIN
  SELECT tournament.status
  INTO parent_status
  FROM public.tournaments AS tournament
  WHERE tournament.id = NEW.tournament_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tournament not found.'
      USING ERRCODE = 'P0002';
  END IF;

  IF parent_status IN ('COMPLETED', 'ARCHIVED') THEN
    RAISE EXCEPTION 'Completed and archived tournaments are read-only.'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.guard_active_tournament_category() FROM PUBLIC;
DROP TRIGGER IF EXISTS categories_terminal_tournament_guard ON public.categories;
CREATE TRIGGER categories_terminal_tournament_guard
  BEFORE INSERT OR UPDATE ON public.categories
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_active_tournament_category();

-- Private draw previews and their publication state are also part of the
-- terminal tournament boundary.
CREATE OR REPLACE FUNCTION private.guard_active_tournament_preview()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  parent_status public.tournament_status;
  target_category_id UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_category_id := OLD.category_id;
  ELSE
    target_category_id := NEW.category_id;
  END IF;

  SELECT tournament.status
  INTO parent_status
  FROM public.categories AS category
  JOIN public.tournaments AS tournament
    ON tournament.id = category.tournament_id
  WHERE category.id = target_category_id;

  IF parent_status IN ('COMPLETED', 'ARCHIVED') THEN
    RAISE EXCEPTION 'Completed and archived tournaments are read-only.'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

REVOKE ALL ON FUNCTION private.guard_active_tournament_preview() FROM PUBLIC;
DROP TRIGGER IF EXISTS category_draw_previews_terminal_tournament_guard ON public.category_draw_previews;
CREATE TRIGGER category_draw_previews_terminal_tournament_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.category_draw_previews
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_active_tournament_preview();

-- Registrations cannot be changed in a terminal tournament. A seed belongs to
-- a confirmed registration; withdrawal automatically clears an old seed, and
-- an explicit attempt to attach a seed to an ineligible row is rejected.
CREATE OR REPLACE FUNCTION private.guard_registration_and_seed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  parent_status public.tournament_status;
BEGIN
  SELECT tournament.status
  INTO parent_status
  FROM public.categories AS category
  JOIN public.tournaments AS tournament
    ON tournament.id = category.tournament_id
  WHERE category.id = NEW.category_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Category not found.'
      USING ERRCODE = 'P0002';
  END IF;

  IF parent_status IN ('COMPLETED', 'ARCHIVED') THEN
    RAISE EXCEPTION 'Completed and archived tournaments are read-only.'
      USING ERRCODE = 'P0001';
  END IF;

  IF NEW.status <> 'CONFIRMED' THEN
    IF TG_OP = 'INSERT' AND NEW.seed_number IS NOT NULL THEN
      RAISE EXCEPTION 'Only confirmed registrations can carry seeds.'
        USING ERRCODE = 'P0001';
    END IF;

    IF TG_OP = 'UPDATE' THEN
      IF NEW.seed_number IS DISTINCT FROM OLD.seed_number
         AND NEW.seed_number IS NOT NULL THEN
        RAISE EXCEPTION 'Only confirmed registrations can carry seeds.'
          USING ERRCODE = 'P0001';
      END IF;
    END IF;

    NEW.seed_number := NULL;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.guard_registration_and_seed() FROM PUBLIC;
DROP TRIGGER IF EXISTS registrations_terminal_and_seed_guard ON public.registrations;
CREATE TRIGGER registrations_terminal_and_seed_guard
  BEFORE INSERT OR UPDATE OF category_id, status, seed_number
  ON public.registrations
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_registration_and_seed();

-- Protect draw, group, and match writes from terminal tournaments as well.
CREATE OR REPLACE FUNCTION private.guard_active_tournament_group()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  parent_status public.tournament_status;
BEGIN
  SELECT tournament.status
  INTO parent_status
  FROM public.categories AS category
  JOIN public.tournaments AS tournament
    ON tournament.id = category.tournament_id
  WHERE category.id = NEW.category_id;

  IF parent_status IN ('COMPLETED', 'ARCHIVED') THEN
    RAISE EXCEPTION 'Completed and archived tournaments are read-only.'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.guard_active_tournament_group() FROM PUBLIC;
DROP TRIGGER IF EXISTS groups_terminal_tournament_guard ON public.groups;
CREATE TRIGGER groups_terminal_tournament_guard
  BEFORE INSERT OR UPDATE ON public.groups
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_active_tournament_group();

CREATE OR REPLACE FUNCTION private.guard_active_tournament_group_member()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  parent_status public.tournament_status;
  target_group_id UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_group_id := OLD.group_id;
  ELSE
    target_group_id := NEW.group_id;
  END IF;

  SELECT tournament.status
  INTO parent_status
  FROM public.groups AS group_record
  JOIN public.categories AS category
    ON category.id = group_record.category_id
  JOIN public.tournaments AS tournament
    ON tournament.id = category.tournament_id
  WHERE group_record.id = target_group_id;

  IF parent_status IN ('COMPLETED', 'ARCHIVED') THEN
    RAISE EXCEPTION 'Completed and archived tournaments are read-only.'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

REVOKE ALL ON FUNCTION private.guard_active_tournament_group_member() FROM PUBLIC;
DROP TRIGGER IF EXISTS group_members_terminal_tournament_guard ON public.group_members;
CREATE TRIGGER group_members_terminal_tournament_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.group_members
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_active_tournament_group_member();

CREATE OR REPLACE FUNCTION private.guard_active_tournament_match()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  parent_status public.tournament_status;
BEGIN
  SELECT tournament.status
  INTO parent_status
  FROM public.categories AS category
  JOIN public.tournaments AS tournament
    ON tournament.id = category.tournament_id
  WHERE category.id = NEW.category_id;

  IF parent_status IN ('COMPLETED', 'ARCHIVED') THEN
    RAISE EXCEPTION 'Completed and archived tournaments are read-only.'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.guard_active_tournament_match() FROM PUBLIC;
DROP TRIGGER IF EXISTS matches_terminal_tournament_guard ON public.matches;
CREATE TRIGGER matches_terminal_tournament_guard
  BEFORE INSERT OR UPDATE ON public.matches
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_active_tournament_match();

CREATE OR REPLACE FUNCTION private.guard_active_tournament_match_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  parent_status public.tournament_status;
  target_match_id UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_match_id := OLD.match_id;
  ELSE
    target_match_id := NEW.match_id;
  END IF;

  SELECT tournament.status
  INTO parent_status
  FROM public.matches AS match_record
  JOIN public.categories AS category
    ON category.id = match_record.category_id
  JOIN public.tournaments AS tournament
    ON tournament.id = category.tournament_id
  WHERE match_record.id = target_match_id;

  IF parent_status IN ('COMPLETED', 'ARCHIVED') THEN
    RAISE EXCEPTION 'Completed and archived tournaments are read-only.'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

REVOKE ALL ON FUNCTION private.guard_active_tournament_match_event() FROM PUBLIC;
DROP TRIGGER IF EXISTS match_events_terminal_tournament_guard ON public.match_events;
CREATE TRIGGER match_events_terminal_tournament_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.match_events
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_active_tournament_match_event();

CREATE OR REPLACE FUNCTION private.guard_active_tournament_match_game()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  parent_status public.tournament_status;
  target_match_id UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_match_id := OLD.match_id;
  ELSE
    target_match_id := NEW.match_id;
  END IF;

  SELECT tournament.status
  INTO parent_status
  FROM public.matches AS match_record
  JOIN public.categories AS category
    ON category.id = match_record.category_id
  JOIN public.tournaments AS tournament
    ON tournament.id = category.tournament_id
  WHERE match_record.id = target_match_id;

  IF parent_status IN ('COMPLETED', 'ARCHIVED') THEN
    RAISE EXCEPTION 'Completed and archived tournaments are read-only.'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

REVOKE ALL ON FUNCTION private.guard_active_tournament_match_game() FROM PUBLIC;
DROP TRIGGER IF EXISTS match_games_terminal_tournament_guard ON public.match_games;
CREATE TRIGGER match_games_terminal_tournament_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.match_games
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_active_tournament_match_game();
