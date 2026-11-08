-- Keep draft and pre-publication tournament/category metadata private while
-- preserving registration and published-history access for players.

CREATE OR REPLACE FUNCTION private.is_category_visible_to_current_user(category_uuid UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF (SELECT private.is_committee_member()) THEN
    RETURN TRUE;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.categories AS category
    WHERE category.id = category_uuid
      AND (
        category.status IN (
          'REGISTRATION_OPEN',
          'REGISTRATION_CLOSED',
          'DRAW_PUBLISHED',
          'GROUP_STAGE_IN_PROGRESS',
          'GROUP_STAGE_COMPLETED',
          'KNOCKOUT_IN_PROGRESS',
          'COMPLETED',
          'ARCHIVED'
        )
        OR EXISTS (
          SELECT 1
          FROM public.registrations AS registration
          WHERE registration.category_id = category.id
            AND registration.player_id = (SELECT auth.uid())
            AND registration.status IN ('CONFIRMED', 'WAITLISTED')
        )
      )
  );
END;
$$;

CREATE OR REPLACE FUNCTION private.is_tournament_visible_to_current_user(tournament_uuid UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF (SELECT private.is_committee_member()) THEN
    RETURN TRUE;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.tournaments AS tournament
    WHERE tournament.id = tournament_uuid
      AND (
        tournament.status IN (
          'REGISTRATION_OPEN',
          'REGISTRATION_CLOSED',
          'DRAW_PUBLISHED',
          'GROUP_STAGE_IN_PROGRESS',
          'GROUP_STAGE_COMPLETED',
          'KNOCKOUT_IN_PROGRESS',
          'COMPLETED',
          'ARCHIVED'
        )
        OR EXISTS (
          SELECT 1
          FROM public.categories AS category
          JOIN public.registrations AS registration
            ON registration.category_id = category.id
          WHERE category.tournament_id = tournament.id
            AND registration.player_id = (SELECT auth.uid())
            AND registration.status IN ('CONFIRMED', 'WAITLISTED')
        )
      )
  );
END;
$$;

REVOKE ALL ON FUNCTION private.is_category_visible_to_current_user(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.is_tournament_visible_to_current_user(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.is_category_visible_to_current_user(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION private.is_tournament_visible_to_current_user(UUID) TO authenticated;

DROP POLICY IF EXISTS "Tournaments: Authenticated users can read" ON public.tournaments;
CREATE POLICY "Tournaments: Committee or visible tournament readers"
  ON public.tournaments
  FOR SELECT
  TO authenticated
  USING ((SELECT private.is_tournament_visible_to_current_user(tournaments.id)));

DROP POLICY IF EXISTS "Categories: Authenticated users can read" ON public.categories;
CREATE POLICY "Categories: Committee or visible category readers"
  ON public.categories
  FOR SELECT
  TO authenticated
  USING ((SELECT private.is_category_visible_to_current_user(categories.id)));

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
    AND (SELECT private.is_category_visible_to_current_user(category.id))
  GROUP BY category.id;
END;
$$;
