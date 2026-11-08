-- Keep draw groups, matches, games, and events private until publication.
-- Committee members retain full visibility for operational review.

DROP POLICY IF EXISTS "Groups: Authenticated users can read" ON public.groups;
CREATE POLICY "Groups: Committee or published category readers"
  ON public.groups
  FOR SELECT
  TO authenticated
  USING (
    (SELECT private.is_committee_member())
    OR EXISTS (
      SELECT 1
      FROM public.categories AS category
      WHERE category.id = groups.category_id
        AND category.status IN (
          'DRAW_PUBLISHED',
          'GROUP_STAGE_IN_PROGRESS',
          'GROUP_STAGE_COMPLETED',
          'KNOCKOUT_IN_PROGRESS',
          'COMPLETED'
        )
    )
  );

DROP POLICY IF EXISTS "Group Members: Authenticated users can read" ON public.group_members;
CREATE POLICY "Group Members: Committee or published category readers"
  ON public.group_members
  FOR SELECT
  TO authenticated
  USING (
    (SELECT private.is_committee_member())
    OR EXISTS (
      SELECT 1
      FROM public.groups AS group_record
      JOIN public.categories AS category
        ON category.id = group_record.category_id
      WHERE group_record.id = group_members.group_id
        AND category.status IN (
          'DRAW_PUBLISHED',
          'GROUP_STAGE_IN_PROGRESS',
          'GROUP_STAGE_COMPLETED',
          'KNOCKOUT_IN_PROGRESS',
          'COMPLETED'
        )
    )
  );

DROP POLICY IF EXISTS "Matches: Authenticated users can read" ON public.matches;
CREATE POLICY "Matches: Committee or published category readers"
  ON public.matches
  FOR SELECT
  TO authenticated
  USING (
    (SELECT private.is_committee_member())
    OR EXISTS (
      SELECT 1
      FROM public.categories AS category
      WHERE category.id = matches.category_id
        AND category.status IN (
          'DRAW_PUBLISHED',
          'GROUP_STAGE_IN_PROGRESS',
          'GROUP_STAGE_COMPLETED',
          'KNOCKOUT_IN_PROGRESS',
          'COMPLETED'
        )
    )
  );

DROP POLICY IF EXISTS "Match Games: Authenticated users can read" ON public.match_games;
CREATE POLICY "Match Games: Committee or published category readers"
  ON public.match_games
  FOR SELECT
  TO authenticated
  USING (
    (SELECT private.is_committee_member())
    OR EXISTS (
      SELECT 1
      FROM public.matches AS match_record
      JOIN public.categories AS category
        ON category.id = match_record.category_id
      WHERE match_record.id = match_games.match_id
        AND category.status IN (
          'DRAW_PUBLISHED',
          'GROUP_STAGE_IN_PROGRESS',
          'GROUP_STAGE_COMPLETED',
          'KNOCKOUT_IN_PROGRESS',
          'COMPLETED'
        )
    )
  );

DROP POLICY IF EXISTS "Match Events: Authenticated users can read" ON public.match_events;
CREATE POLICY "Match Events: Committee or published category readers"
  ON public.match_events
  FOR SELECT
  TO authenticated
  USING (
    (SELECT private.is_committee_member())
    OR EXISTS (
      SELECT 1
      FROM public.matches AS match_record
      JOIN public.categories AS category
        ON category.id = match_record.category_id
      WHERE match_record.id = match_events.match_id
        AND category.status IN (
          'DRAW_PUBLISHED',
          'GROUP_STAGE_IN_PROGRESS',
          'GROUP_STAGE_COMPLETED',
          'KNOCKOUT_IN_PROGRESS',
          'COMPLETED'
        )
    )
  );

-- Policy lookups follow foreign-key columns used by the read predicates.
CREATE INDEX IF NOT EXISTS groups_category_id_idx ON public.groups(category_id);
CREATE INDEX IF NOT EXISTS group_members_group_id_idx ON public.group_members(group_id);
CREATE INDEX IF NOT EXISTS matches_category_id_idx ON public.matches(category_id);
CREATE INDEX IF NOT EXISTS match_games_match_id_idx ON public.match_games(match_id);
CREATE INDEX IF NOT EXISTS match_events_match_id_idx ON public.match_events(match_id);
