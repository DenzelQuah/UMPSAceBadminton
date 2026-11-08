-- Knockout bracket review, seeded generation, and automatic advancement.
-- This migration supports power-of-two qualifier counts only. Byes and
-- non-power-of-two brackets remain an explicit product decision and are
-- rejected rather than guessed.

BEGIN;

ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS knockout_stage VARCHAR(32);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'matches_knockout_stage_length'
      AND conrelid = 'public.matches'::regclass
  ) THEN
    ALTER TABLE public.matches
      ADD CONSTRAINT matches_knockout_stage_length
      CHECK (knockout_stage IS NULL OR char_length(knockout_stage) <= 32);
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.category_knockout_previews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID NOT NULL UNIQUE REFERENCES public.categories(id) ON DELETE CASCADE,
  qualifier_count INTEGER NOT NULL CHECK (qualifier_count >= 2),
  bracket_payload JSONB NOT NULL CHECK (jsonb_typeof(bracket_payload) = 'object'),
  status VARCHAR(20) NOT NULL DEFAULT 'READY'
    CHECK (status IN ('READY', 'PUBLISHED', 'CANCELLED')),
  generated_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  generated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  published_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
  published_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS category_knockout_previews_status_idx
  ON public.category_knockout_previews(category_id, status);

DROP TRIGGER IF EXISTS category_knockout_previews_terminal_tournament_guard
  ON public.category_knockout_previews;
CREATE TRIGGER category_knockout_previews_terminal_tournament_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.category_knockout_previews
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_active_tournament_preview();

ALTER TABLE public.category_knockout_previews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Knockout previews: committee or published readers"
  ON public.category_knockout_previews;
CREATE POLICY "Knockout previews: committee or published readers"
  ON public.category_knockout_previews
  FOR SELECT
  TO authenticated
  USING (
    (SELECT private.is_committee_member())
    OR (
      status = 'PUBLISHED'
      AND EXISTS (
        SELECT 1
        FROM public.categories AS category
        WHERE category.id = category_knockout_previews.category_id
          AND category.status IN ('KNOCKOUT_IN_PROGRESS', 'COMPLETED')
      )
    )
  );

REVOKE ALL ON public.category_knockout_previews FROM anon, authenticated;
GRANT SELECT ON public.category_knockout_previews TO authenticated;

CREATE OR REPLACE FUNCTION private.sync_group_stage_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  all_group_matches_final BOOLEAN;
BEGIN
  IF NEW.group_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.status IN ('COMPLETED', 'WALKOVER', 'RETIRED') THEN
    SELECT NOT EXISTS (
      SELECT 1
      FROM public.matches AS match
      WHERE match.category_id = NEW.category_id
        AND match.group_id IS NOT NULL
        AND match.status NOT IN ('COMPLETED', 'WALKOVER', 'RETIRED')
    )
    INTO all_group_matches_final;

    IF all_group_matches_final THEN
      UPDATE public.categories
      SET status = 'GROUP_STAGE_COMPLETED'
      WHERE id = NEW.category_id
        AND status IN ('DRAW_PUBLISHED', 'GROUP_STAGE_IN_PROGRESS');
    END IF;
  ELSIF NEW.status = 'IN_PROGRESS' THEN
    UPDATE public.categories
    SET status = 'GROUP_STAGE_IN_PROGRESS'
    WHERE id = NEW.category_id
      AND status = 'DRAW_PUBLISHED';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS matches_group_stage_status_sync ON public.matches;
CREATE TRIGGER matches_group_stage_status_sync
AFTER INSERT OR UPDATE OF status ON public.matches
FOR EACH ROW
EXECUTE FUNCTION private.sync_group_stage_status();

REVOKE ALL ON FUNCTION private.sync_group_stage_status() FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_category_qualifier_count(
  category_uuid UUID,
  qualifier_count_value INTEGER
)
RETURNS public.categories
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor UUID := (SELECT auth.uid());
  category_record public.categories%ROWTYPE;
  previous_count INTEGER;
BEGIN
  IF actor IS NULL OR NOT (SELECT private.is_committee_member()) THEN
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

  IF category_record.status NOT IN ('DRAFT', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'DRAW_PREPARATION') THEN
    RAISE EXCEPTION 'Qualifiers cannot be changed after the draw has been generated.'
      USING ERRCODE = 'P0001';
  END IF;

  IF qualifier_count_value < 1
     OR qualifier_count_value > floor(category_record.max_capacity::NUMERIC / category_record.group_count::NUMERIC) THEN
    RAISE EXCEPTION 'Qualifier count is invalid for this category capacity.'
      USING ERRCODE = '22023';
  END IF;

  previous_count := category_record.qualifiers_per_group;
  UPDATE public.categories
  SET qualifiers_per_group = qualifier_count_value
  WHERE id = category_uuid
  RETURNING * INTO category_record;

  INSERT INTO public.audit_logs (
    actor_id, action, entity_type, entity_id, original_data, new_data
  )
  VALUES (
    actor,
    'CATEGORY_QUALIFIER_COUNT_CHANGED',
    'category',
    category_uuid,
    jsonb_build_object('qualifiers_per_group', previous_count),
    jsonb_build_object('qualifiers_per_group', qualifier_count_value)
  );

  RETURN category_record;
END;
$$;

REVOKE ALL ON FUNCTION public.set_category_qualifier_count(UUID, INTEGER) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_category_qualifier_count(UUID, INTEGER) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.save_category_knockout_preview(
  category_uuid UUID,
  qualifier_count_value INTEGER,
  bracket_payload_value JSONB
)
RETURNS public.category_knockout_previews
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor UUID := (SELECT auth.uid());
  category_record public.categories%ROWTYPE;
  preview_record public.category_knockout_previews%ROWTYPE;
  expected_count INTEGER;
  seed_count INTEGER;
  distinct_seed_count INTEGER;
  first_round_count INTEGER;
  round_count INTEGER;
BEGIN
  IF actor IS NULL OR NOT (SELECT private.is_committee_member()) THEN
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

  IF category_record.status NOT IN (
    'DRAW_PUBLISHED',
    'GROUP_STAGE_IN_PROGRESS',
    'GROUP_STAGE_COMPLETED'
  ) THEN
    RAISE EXCEPTION 'The group stage is not ready for knockout review.'
      USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.matches AS match
    WHERE match.category_id = category_uuid
      AND match.group_id IS NOT NULL
      AND match.status NOT IN ('COMPLETED', 'WALKOVER', 'RETIRED')
  ) THEN
    RAISE EXCEPTION 'Every group-stage match must be finalized before the knockout proposal.'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.categories
  SET status = 'GROUP_STAGE_COMPLETED'
  WHERE id = category_uuid
    AND status IN ('DRAW_PUBLISHED', 'GROUP_STAGE_IN_PROGRESS');

  expected_count := category_record.group_count * category_record.qualifiers_per_group;
  IF qualifier_count_value IS DISTINCT FROM expected_count THEN
    RAISE EXCEPTION 'The bracket qualifier count must match the category configuration.'
      USING ERRCODE = '22023';
  END IF;

  IF qualifier_count_value < 8
     OR (qualifier_count_value & (qualifier_count_value - 1)) <> 0 THEN
    RAISE EXCEPTION 'Only power-of-two knockout brackets with at least eight qualifiers are supported; byes are not configured.'
      USING ERRCODE = '22023';
  END IF;

  IF bracket_payload_value IS NULL
     OR jsonb_typeof(bracket_payload_value) <> 'object'
     OR jsonb_typeof(bracket_payload_value -> 'seeds') <> 'array'
     OR jsonb_typeof(bracket_payload_value -> 'rounds') <> 'array' THEN
    RAISE EXCEPTION 'The bracket proposal is malformed.'
      USING ERRCODE = '22023';
  END IF;

  round_count := log(2::NUMERIC, qualifier_count_value::NUMERIC)::INTEGER;
  IF jsonb_array_length(bracket_payload_value -> 'rounds') IS DISTINCT FROM round_count THEN
    RAISE EXCEPTION 'The bracket proposal has an invalid number of rounds.'
      USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(bracket_payload_value -> 'rounds' -> 0) IS DISTINCT FROM 'object'
     OR jsonb_typeof(bracket_payload_value -> 'rounds' -> 0 -> 'pairings') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'The first bracket round is malformed.'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(bracket_payload_value -> 'rounds') AS round_value(value)
    WHERE char_length(coalesce(round_value.value ->> 'label', '')) > 32
  ) THEN
    RAISE EXCEPTION 'Bracket round labels are too long.'
      USING ERRCODE = '22023';
  END IF;

  seed_count := jsonb_array_length(bracket_payload_value -> 'seeds');
  IF seed_count IS DISTINCT FROM qualifier_count_value THEN
    RAISE EXCEPTION 'Every bracket seed must be present exactly once.'
      USING ERRCODE = '22023';
  END IF;

  SELECT count(DISTINCT (seed.value ->> 'player_id')::UUID)
  INTO distinct_seed_count
  FROM jsonb_array_elements(bracket_payload_value -> 'seeds') AS seed(value);

  IF distinct_seed_count IS DISTINCT FROM qualifier_count_value THEN
    RAISE EXCEPTION 'A player cannot appear in more than one bracket seed.'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(bracket_payload_value -> 'seeds') AS seed(value)
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.group_members AS member
      JOIN public.groups AS group_record
        ON group_record.id = member.group_id
      WHERE group_record.category_id = category_uuid
        AND member.player_id = (seed.value ->> 'player_id')::UUID
        AND (seed.value ->> 'place')::INTEGER
          BETWEEN 1 AND category_record.qualifiers_per_group
    )
  ) THEN
    RAISE EXCEPTION 'Every seed must be a qualified player from this category.'
      USING ERRCODE = '22023';
  END IF;

  first_round_count := jsonb_array_length(bracket_payload_value -> 'rounds' -> 0 -> 'pairings');
  IF first_round_count IS DISTINCT FROM qualifier_count_value / 2 THEN
    RAISE EXCEPTION 'The first bracket round has an invalid number of pairings.'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(bracket_payload_value -> 'rounds' -> 0 -> 'pairings') AS pairing(value)
    WHERE (pairing.value ->> 'player_a_id') IS NULL
       OR (pairing.value ->> 'player_b_id') IS NULL
       OR (pairing.value ->> 'player_a_id')::UUID = (pairing.value ->> 'player_b_id')::UUID
  ) THEN
    RAISE EXCEPTION 'Every first-round pairing must contain two different seeded players.'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (
      SELECT (pairing.value ->> 'player_a_id')::UUID AS player_id
      FROM jsonb_array_elements(bracket_payload_value -> 'rounds' -> 0 -> 'pairings') AS pairing(value)
      UNION ALL
      SELECT (pairing.value ->> 'player_b_id')::UUID
      FROM jsonb_array_elements(bracket_payload_value -> 'rounds' -> 0 -> 'pairings') AS pairing(value)
    ) AS pairing_players
    WHERE NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(bracket_payload_value -> 'seeds') AS seed(value)
      WHERE (seed.value ->> 'player_id')::UUID = pairing_players.player_id
    )
  ) THEN
    RAISE EXCEPTION 'First-round pairings must use the seeded qualifiers.'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.category_knockout_previews AS existing
    WHERE existing.category_id = category_uuid
      AND existing.status = 'PUBLISHED'
  ) THEN
    RAISE EXCEPTION 'A knockout bracket has already been published for this category.'
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.category_knockout_previews (
    category_id,
    qualifier_count,
    bracket_payload,
    status,
    generated_by,
    generated_at,
    created_at,
    updated_at
  )
  VALUES (
    category_uuid,
    qualifier_count_value,
    bracket_payload_value,
    'READY',
    actor,
    now(),
    now(),
    now()
  )
  ON CONFLICT (category_id) DO UPDATE
  SET qualifier_count = EXCLUDED.qualifier_count,
      bracket_payload = EXCLUDED.bracket_payload,
      status = 'READY',
      generated_by = EXCLUDED.generated_by,
      generated_at = now(),
      published_by = NULL,
      published_at = NULL,
      updated_at = now()
  RETURNING * INTO preview_record;

  INSERT INTO public.audit_logs (
    actor_id, action, entity_type, entity_id, original_data, new_data
  )
  VALUES (
    actor,
    'KNOCKOUT_PREVIEW_SAVED',
    'category_knockout_preview',
    preview_record.id,
    NULL,
    jsonb_build_object('qualifier_count', qualifier_count_value, 'status', 'READY')
  );

  RETURN preview_record;
END;
$$;

CREATE OR REPLACE FUNCTION public.publish_category_knockout_bracket(
  category_uuid UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor UUID := (SELECT auth.uid());
  category_record public.categories%ROWTYPE;
  preview_record public.category_knockout_previews%ROWTYPE;
  pairing_value JSONB;
  match_id_value UUID;
  updated_pairings JSONB := '[]'::JSONB;
  created_matches JSONB := '[]'::JSONB;
  rounds_value JSONB;
  first_round JSONB;
  first_round_label TEXT;
BEGIN
  IF actor IS NULL OR NOT (SELECT private.is_committee_member()) THEN
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

  SELECT preview.*
  INTO preview_record
  FROM public.category_knockout_previews AS preview
  WHERE preview.category_id = category_uuid
  FOR UPDATE;

  IF NOT FOUND OR preview_record.status <> 'READY' THEN
    RAISE EXCEPTION 'Review and save a knockout proposal before publishing it.'
      USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.matches AS match
    WHERE match.category_id = category_uuid
      AND match.knockout_round IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Knockout matches already exist for this category.'
      USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.matches AS match
    WHERE match.category_id = category_uuid
      AND match.group_id IS NOT NULL
      AND match.status NOT IN ('COMPLETED', 'WALKOVER', 'RETIRED')
  ) THEN
    RAISE EXCEPTION 'Every group-stage match must be finalized before the knockout bracket is published.'
      USING ERRCODE = 'P0001';
  END IF;

  rounds_value := preview_record.bracket_payload -> 'rounds';
  first_round := rounds_value -> 0;
  first_round_label := first_round ->> 'label';

  FOR pairing_value IN
    SELECT value
    FROM jsonb_array_elements(first_round -> 'pairings')
  LOOP
    INSERT INTO public.matches (
      category_id,
      group_id,
      knockout_round,
      knockout_stage,
      player_a_id,
      player_b_id,
      status
    )
    VALUES (
      category_uuid,
      NULL,
      1,
      first_round_label,
      (pairing_value ->> 'player_a_id')::UUID,
      (pairing_value ->> 'player_b_id')::UUID,
      'SCHEDULED'
    )
    RETURNING id INTO match_id_value;

    updated_pairings := updated_pairings ||
      jsonb_set(pairing_value, '{match_id}', to_jsonb(match_id_value::TEXT), true);
    created_matches := created_matches || jsonb_build_array(
      jsonb_build_object(
        'match_id', match_id_value,
        'player_a_id', pairing_value ->> 'player_a_id',
        'player_b_id', pairing_value ->> 'player_b_id',
        'round', 1,
        'label', first_round_label
      )
    );
  END LOOP;

  rounds_value := jsonb_set(rounds_value, '{0,pairings}', updated_pairings, true);
  UPDATE public.category_knockout_previews
  SET bracket_payload = jsonb_set(preview_record.bracket_payload, '{rounds}', rounds_value, true),
      status = 'PUBLISHED',
      published_by = actor,
      published_at = now(),
      updated_at = now()
  WHERE id = preview_record.id;

  UPDATE public.categories
  SET status = 'KNOCKOUT_IN_PROGRESS'
  WHERE id = category_uuid;

  PERFORM private.sync_tournament_status(category_uuid);

  INSERT INTO public.audit_logs (
    actor_id, action, entity_type, entity_id, original_data, new_data
  )
  VALUES (
    actor,
    'KNOCKOUT_BRACKET_PUBLISHED',
    'category_knockout_preview',
    preview_record.id,
    jsonb_build_object('status', 'READY'),
    jsonb_build_object('status', 'PUBLISHED', 'first_round', first_round_label)
  );

  RETURN jsonb_build_object(
    'category_id', category_uuid,
    'status', 'PUBLISHED',
    'matches', created_matches
  );
END;
$$;

CREATE OR REPLACE FUNCTION private.advance_knockout_bracket(match_uuid UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  match_record public.matches%ROWTYPE;
  preview_record public.category_knockout_previews%ROWTYPE;
  rounds_value JSONB;
  current_pairing JSONB;
  next_pairing JSONB;
  pairing_value JSONB;
  updated_pairings JSONB := '[]'::JSONB;
  current_index INTEGER;
  next_index INTEGER;
  sibling_index INTEGER;
  sibling_match_id UUID;
  sibling_winner UUID;
  next_match_id UUID;
  next_player_a UUID;
  next_player_b UUID;
  next_label TEXT;
  current_is_first_source BOOLEAN;
BEGIN
  SELECT match.*
  INTO match_record
  FROM public.matches AS match
  WHERE match.id = match_uuid;

  IF NOT FOUND
     OR match_record.knockout_round IS NULL
     OR match_record.status NOT IN ('COMPLETED', 'WALKOVER', 'RETIRED')
     OR match_record.winner_id IS NULL THEN
    RETURN;
  END IF;

  SELECT preview.*
  INTO preview_record
  FROM public.category_knockout_previews AS preview
  WHERE preview.category_id = match_record.category_id
    AND preview.status = 'PUBLISHED'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  rounds_value := preview_record.bracket_payload -> 'rounds';

  SELECT value
  INTO current_pairing
  FROM jsonb_array_elements(rounds_value -> (match_record.knockout_round - 1) -> 'pairings') AS pairing(value)
  WHERE pairing.value ->> 'match_id' = match_uuid::TEXT
  LIMIT 1;

  IF current_pairing IS NULL THEN
    RETURN;
  END IF;

  current_index := (current_pairing ->> 'index')::INTEGER;

  SELECT value
  INTO next_pairing
  FROM jsonb_array_elements(rounds_value -> match_record.knockout_round -> 'pairings') AS pairing(value)
  WHERE EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(pairing.value -> 'source_pairing_indexes') AS source(index_text)
    WHERE source.index_text::INTEGER = current_index
  )
  LIMIT 1;

  IF next_pairing IS NULL OR NULLIF(next_pairing ->> 'match_id', '') IS NOT NULL THEN
    RETURN;
  END IF;

  SELECT source.index_text::INTEGER
  INTO sibling_index
  FROM jsonb_array_elements_text(next_pairing -> 'source_pairing_indexes') AS source(index_text)
  WHERE source.index_text::INTEGER <> current_index
  LIMIT 1;

  SELECT (value ->> 'match_id')::UUID
  INTO sibling_match_id
  FROM jsonb_array_elements(rounds_value -> (match_record.knockout_round - 1) -> 'pairings') AS pairing(value)
  WHERE (value ->> 'index')::INTEGER = sibling_index
  LIMIT 1;

  IF sibling_match_id IS NULL THEN
    RETURN;
  END IF;

  SELECT winner_id
  INTO sibling_winner
  FROM public.matches
  WHERE id = sibling_match_id
    AND status IN ('COMPLETED', 'WALKOVER', 'RETIRED')
  LIMIT 1;

  IF sibling_winner IS NULL THEN
    RETURN;
  END IF;

  current_is_first_source := (next_pairing -> 'source_pairing_indexes' ->> 0)::INTEGER = current_index;

  IF current_is_first_source THEN
    next_player_a := match_record.winner_id;
    next_player_b := sibling_winner;
  ELSE
    next_player_a := sibling_winner;
    next_player_b := match_record.winner_id;
  END IF;

  next_label := rounds_value -> match_record.knockout_round ->> 'label';

  INSERT INTO public.matches (
    category_id,
    group_id,
    knockout_round,
    knockout_stage,
    player_a_id,
    player_b_id,
    status
  )
  VALUES (
    match_record.category_id,
    NULL,
    match_record.knockout_round + 1,
    next_label,
    next_player_a,
    next_player_b,
    'SCHEDULED'
  )
  RETURNING id INTO next_match_id;

  next_index := (next_pairing ->> 'index')::INTEGER;
  FOR pairing_value IN
    SELECT value
    FROM jsonb_array_elements(rounds_value -> match_record.knockout_round -> 'pairings')
  LOOP
    IF (pairing_value ->> 'index')::INTEGER = next_index THEN
      pairing_value := jsonb_set(pairing_value, '{match_id}', to_jsonb(next_match_id::TEXT), true);
      pairing_value := jsonb_set(pairing_value, '{player_a_id}', to_jsonb(next_player_a::TEXT), true);
      pairing_value := jsonb_set(pairing_value, '{player_b_id}', to_jsonb(next_player_b::TEXT), true);
    END IF;
    updated_pairings := updated_pairings || pairing_value;
  END LOOP;

  rounds_value := jsonb_set(
    rounds_value,
    ARRAY[match_record.knockout_round::TEXT, 'pairings'],
    updated_pairings,
    true
  );

  UPDATE public.category_knockout_previews
  SET bracket_payload = jsonb_set(preview_record.bracket_payload, '{rounds}', rounds_value, true),
      updated_at = now()
  WHERE id = preview_record.id;

  PERFORM private.sync_tournament_status(match_record.category_id);

  INSERT INTO public.audit_logs (
    actor_id, action, entity_type, entity_id, original_data, new_data
  )
  VALUES (
    auth.uid(),
    'KNOCKOUT_MATCH_ADVANCED',
    'match',
    next_match_id,
    jsonb_build_object('source_match_id', match_record.id),
    jsonb_build_object('next_match_id', next_match_id, 'knockout_round', match_record.knockout_round + 1)
  );
END;
$$;

CREATE OR REPLACE FUNCTION private.guard_knockout_advancement_reassignment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF OLD.knockout_round IS NOT NULL
     AND OLD.status IN ('COMPLETED', 'WALKOVER', 'RETIRED')
     AND (NEW.status IS DISTINCT FROM OLD.status OR NEW.winner_id IS DISTINCT FROM OLD.winner_id)
     AND EXISTS (
       SELECT 1
       FROM public.matches AS next_round
       WHERE next_round.category_id = OLD.category_id
         AND next_round.knockout_round = OLD.knockout_round + 1
     ) THEN
    RAISE EXCEPTION 'A knockout result with a downstream match cannot be reassigned.'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS knockout_advancement_reassignment_guard ON public.matches;
CREATE TRIGGER knockout_advancement_reassignment_guard
BEFORE UPDATE OF status, winner_id ON public.matches
FOR EACH ROW
EXECUTE FUNCTION private.guard_knockout_advancement_reassignment();

REVOKE ALL ON FUNCTION private.guard_knockout_advancement_reassignment() FROM PUBLIC, anon, authenticated, service_role;

-- Define the adapter before installing the trigger so a fresh database can replay
-- this migration without relying on an out-of-band Dashboard function.
CREATE OR REPLACE FUNCTION private.knockout_match_advance_trigger()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM private.advance_knockout_bracket(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS knockout_match_advance_trigger ON public.matches;
CREATE TRIGGER knockout_match_advance_trigger
AFTER UPDATE OF status, winner_id ON public.matches
FOR EACH ROW
EXECUTE FUNCTION private.knockout_match_advance_trigger();

REVOKE ALL ON FUNCTION public.save_category_knockout_preview(UUID, INTEGER, JSONB) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.publish_category_knockout_bracket(UUID) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.advance_knockout_bracket(UUID) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.knockout_match_advance_trigger() FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA private TO service_role;
GRANT EXECUTE ON FUNCTION public.save_category_knockout_preview(UUID, INTEGER, JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.publish_category_knockout_bracket(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.advance_knockout_bracket(UUID) TO service_role;

COMMIT;
