-- Live match operations for assigned umpires and committee administrators.
-- Score mutations are exposed only through verified RPCs; clients never receive
-- direct write access to match_games or match_events.

CREATE OR REPLACE FUNCTION private.is_valid_game_score(
  format_value public.scoring_format,
  game_number_value INTEGER,
  player_a_value INTEGER,
  player_b_value INTEGER
)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
SET search_path = ''
AS $$
  SELECT
    game_number_value BETWEEN 1 AND
      CASE WHEN format_value = 'STANDARD_3X21' THEN 3 ELSE 1 END
    AND player_a_value >= 0
    AND player_b_value >= 0
    AND player_a_value <= 30
    AND player_b_value <= 30
    AND NOT (player_a_value = 30 AND player_b_value = 30)
    AND NOT (player_a_value = 30 AND player_b_value > 29)
    AND NOT (player_b_value = 30 AND player_a_value > 29)
    AND (
      format_value <> 'SINGLE_SET_1X30'
      OR (player_a_value <= 30 AND player_b_value <= 30)
    );
$$;

CREATE OR REPLACE FUNCTION private.is_game_complete(
  format_value public.scoring_format,
  player_a_value INTEGER,
  player_b_value INTEGER
)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN format_value = 'SINGLE_SET_1X30' THEN
      player_a_value = 30 OR player_b_value = 30
    WHEN player_a_value >= 21 AND player_b_value >= 21 THEN
      player_a_value = 30 OR player_b_value = 30 OR abs(player_a_value - player_b_value) >= 2
    WHEN player_a_value >= 21 THEN
      player_a_value - player_b_value >= 2
    WHEN player_b_value >= 21 THEN
      player_b_value - player_a_value >= 2
    ELSE FALSE
  END;
$$;

CREATE OR REPLACE FUNCTION private.is_authorized_match_operator(match_uuid UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.matches AS match
    WHERE match.id = match_uuid
      AND (
        match.umpire_id = (SELECT auth.uid())
        OR (SELECT private.is_committee_member())
      )
  );
$$;

CREATE OR REPLACE FUNCTION private.adjust_group_standings(
  match_uuid UUID,
  direction INTEGER
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  match_record public.matches%ROWTYPE;
  game_record public.match_games%ROWTYPE;
BEGIN
  IF direction IS NULL OR direction NOT IN (-1, 1) THEN
    RAISE EXCEPTION 'Invalid standings direction.'
      USING ERRCODE = '22023';
  END IF;

  SELECT match.*
  INTO match_record
  FROM public.matches AS match
  WHERE match.id = match_uuid;

  IF NOT FOUND OR match_record.group_id IS NULL OR match_record.winner_id IS NULL THEN
    RETURN;
  END IF;

  IF match_record.status NOT IN ('COMPLETED', 'WALKOVER', 'RETIRED') THEN
    RETURN;
  END IF;

  UPDATE public.group_members AS member
  SET
    matches_played = GREATEST(0, member.matches_played + direction),
    matches_won = GREATEST(
      0,
      member.matches_won + direction * CASE WHEN member.player_id = match_record.winner_id THEN 1 ELSE 0 END
    ),
    matches_lost = GREATEST(
      0,
      member.matches_lost + direction * CASE WHEN member.player_id <> match_record.winner_id THEN 1 ELSE 0 END
    ),
    points_won = GREATEST(
      0,
      member.points_won + direction * COALESCE((
        SELECT SUM(
          CASE
            WHEN match_record.winner_id = match_record.player_a_id THEN game.player_a_score
            ELSE game.player_b_score
          END
        )
        FROM public.match_games AS game
        WHERE game.match_id = match_record.id
      ), 0)
    ),
    points_lost = GREATEST(
      0,
      member.points_lost + direction * COALESCE((
        SELECT SUM(
          CASE
            WHEN match_record.winner_id = match_record.player_a_id THEN game.player_b_score
            ELSE game.player_a_score
          END
        )
        FROM public.match_games AS game
        WHERE game.match_id = match_record.id
      ), 0)
    ),
    standings_points = GREATEST(
      0,
      member.standings_points + direction * CASE WHEN member.player_id = match_record.winner_id THEN 2 ELSE 0 END
    )
  WHERE member.group_id = match_record.group_id
    AND member.player_id IN (match_record.player_a_id, match_record.player_b_id);

  UPDATE public.group_members
  SET net_points = points_won - points_lost
  WHERE group_id = match_record.group_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.start_match(match_uuid UUID)
RETURNS public.matches
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  match_record public.matches%ROWTYPE;
  previous_status public.match_status;
  actor UUID := (SELECT auth.uid());
BEGIN
  IF actor IS NULL OR NOT (SELECT private.is_authorized_match_operator(match_uuid)) THEN
    RAISE EXCEPTION 'You are not assigned to this match.'
      USING ERRCODE = '42501';
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

  IF NOT (SELECT private.is_authorized_match_operator(match_uuid)) THEN
    RAISE EXCEPTION 'You are not assigned to this match.'
      USING ERRCODE = '42501';
  END IF;

  IF match_record.status NOT IN ('SCHEDULED', 'READY') THEN
    RAISE EXCEPTION 'This match cannot be started from its current state.'
      USING ERRCODE = 'P0001';
  END IF;

  previous_status := match_record.status;

  UPDATE public.matches
  SET status = 'IN_PROGRESS'
  WHERE id = match_uuid
  RETURNING * INTO match_record;

  INSERT INTO public.audit_logs (
    actor_id, action, entity_type, entity_id, original_data, new_data
  )
  VALUES (
    actor,
    'MATCH_STARTED',
    'match',
    match_uuid,
    jsonb_build_object('status', previous_status),
    jsonb_build_object('status', 'IN_PROGRESS')
  );

  RETURN match_record;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_game_score(
  match_uuid UUID,
  game_number_value INTEGER,
  player_a_value INTEGER,
  player_b_value INTEGER
)
RETURNS public.match_games
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor UUID := (SELECT auth.uid());
  match_record public.matches%ROWTYPE;
  format_value public.scoring_format;
  game_record public.match_games%ROWTYPE;
  previous_a INTEGER;
  previous_b INTEGER;
BEGIN
  IF actor IS NULL OR NOT (SELECT private.is_authorized_match_operator(match_uuid)) THEN
    RAISE EXCEPTION 'You are not assigned to this match.'
      USING ERRCODE = '42501';
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

  SELECT category.format
  INTO format_value
  FROM public.categories AS category
  WHERE category.id = match_record.category_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Scoring category not found.'
      USING ERRCODE = 'P0002';
  END IF;

  IF NOT (SELECT private.is_authorized_match_operator(match_uuid)) THEN
    RAISE EXCEPTION 'You are not assigned to this match.'
      USING ERRCODE = '42501';
  END IF;

  IF match_record.status <> 'IN_PROGRESS' THEN
    RAISE EXCEPTION 'Scores can only be changed while the match is in progress.'
      USING ERRCODE = 'P0001';
  END IF;

  IF NOT (SELECT private.is_valid_game_score(format_value, game_number_value, player_a_value, player_b_value)) THEN
    RAISE EXCEPTION 'The submitted score is invalid for this scoring format.'
      USING ERRCODE = '22023';
  END IF;

  SELECT game.*
  INTO game_record
  FROM public.match_games AS game
  WHERE game.match_id = match_uuid
    AND game.game_number = game_number_value
  FOR UPDATE;

  IF FOUND THEN
    previous_a := game_record.player_a_score;
    previous_b := game_record.player_b_score;
    IF (SELECT private.is_game_complete(format_value, previous_a, previous_b)) THEN
      RAISE EXCEPTION 'A completed game can only be changed by an administrator override.'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  INSERT INTO public.match_games (
    match_id, game_number, player_a_score, player_b_score
  )
  VALUES (match_uuid, game_number_value, player_a_value, player_b_value)
  ON CONFLICT (match_id, game_number) DO UPDATE
  SET player_a_score = EXCLUDED.player_a_score,
      player_b_score = EXCLUDED.player_b_score
  RETURNING * INTO game_record;

  INSERT INTO public.audit_logs (
    actor_id, action, entity_type, entity_id, original_data, new_data
  )
  VALUES (
    actor,
    'GAME_SCORE_UPDATED',
    'match_game',
    game_record.id,
    CASE WHEN previous_a IS NULL THEN NULL ELSE jsonb_build_object('player_a_score', previous_a, 'player_b_score', previous_b) END,
    jsonb_build_object('player_a_score', player_a_value, 'player_b_score', player_b_value)
  );

  RETURN game_record;
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_match_result(match_uuid UUID)
RETURNS TABLE (
  id UUID,
  status VARCHAR,
  winner_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor UUID := (SELECT auth.uid());
  match_record public.matches%ROWTYPE;
  format_value public.scoring_format;
  completed_a INTEGER;
  completed_b INTEGER;
  invalid_game_count INTEGER;
  game_numbers INTEGER[];
  winner UUID;
BEGIN
  IF actor IS NULL OR NOT (SELECT private.is_authorized_match_operator(match_uuid)) THEN
    RAISE EXCEPTION 'You are not assigned to this match.'
      USING ERRCODE = '42501';
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

  SELECT category.format
  INTO format_value
  FROM public.categories AS category
  WHERE category.id = match_record.category_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Scoring category not found.'
      USING ERRCODE = 'P0002';
  END IF;

  IF NOT (SELECT private.is_authorized_match_operator(match_uuid)) THEN
    RAISE EXCEPTION 'You are not assigned to this match.'
      USING ERRCODE = '42501';
  END IF;

  IF match_record.status <> 'IN_PROGRESS' THEN
    RAISE EXCEPTION 'Only an in-progress match can be submitted.'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT
    count(*) FILTER (WHERE NOT (SELECT private.is_valid_game_score(format_value, game.game_number, game.player_a_score, game.player_b_score))),
    count(*) FILTER (WHERE (SELECT private.is_game_complete(format_value, game.player_a_score, game.player_b_score)) AND game.player_a_score > game.player_b_score),
    count(*) FILTER (WHERE (SELECT private.is_game_complete(format_value, game.player_a_score, game.player_b_score)) AND game.player_b_score > game.player_a_score)
  INTO invalid_game_count, completed_a, completed_b
  FROM public.match_games AS game
  WHERE game.match_id = match_uuid;

  IF invalid_game_count > 0 THEN
    RAISE EXCEPTION 'One or more game scores are invalid.'
      USING ERRCODE = '22023';
  END IF;

  SELECT array_agg(game.game_number ORDER BY game.game_number)
  INTO game_numbers
  FROM public.match_games AS game
  WHERE game.match_id = match_uuid;

  IF format_value = 'SINGLE_SET_1X30' THEN
    IF completed_a + completed_b <> 1 OR game_numbers IS DISTINCT FROM ARRAY[1]::INTEGER[] THEN
      RAISE EXCEPTION 'The single game is not complete.'
        USING ERRCODE = 'P0001';
    END IF;
    winner := CASE WHEN completed_a = 1 THEN match_record.player_a_id ELSE match_record.player_b_id END;
  ELSE
    IF NOT (
      (completed_a = 2 AND completed_b = 0 AND game_numbers = ARRAY[1, 2]::INTEGER[])
      OR (completed_a = 0 AND completed_b = 2 AND game_numbers = ARRAY[1, 2]::INTEGER[])
      OR (completed_a = 2 AND completed_b = 1 AND game_numbers = ARRAY[1, 2, 3]::INTEGER[])
      OR (completed_a = 1 AND completed_b = 2 AND game_numbers = ARRAY[1, 2, 3]::INTEGER[])
    ) THEN
      RAISE EXCEPTION 'A standard match must contain a valid 2-0 or 2-1 game sequence.'
        USING ERRCODE = 'P0001';
    END IF;
    winner := CASE WHEN completed_a = 2 THEN match_record.player_a_id ELSE match_record.player_b_id END;
  END IF;

  UPDATE public.matches AS match
  SET status = 'COMPLETED', winner_id = winner
  WHERE match.id = match_uuid
  RETURNING * INTO match_record;

  PERFORM private.adjust_group_standings(match_uuid, 1);
  PERFORM private.sync_tournament_status(match_record.category_id);

  INSERT INTO public.audit_logs (
    actor_id, action, entity_type, entity_id, original_data, new_data
  )
  VALUES (
    actor,
    'MATCH_RESULT_SUBMITTED',
    'match',
    match_uuid,
    jsonb_build_object('status', 'IN_PROGRESS'),
    jsonb_build_object('status', 'COMPLETED', 'winner_id', winner)
  );

  RETURN QUERY SELECT match_uuid, 'COMPLETED'::VARCHAR, winner;
END;
$$;

CREATE OR REPLACE FUNCTION public.log_disciplinary_card(
  match_uuid UUID,
  card_value public.disciplinary_card,
  player_uuid UUID DEFAULT NULL
)
RETURNS public.match_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor UUID := (SELECT auth.uid());
  match_record public.matches%ROWTYPE;
  event_record public.match_events%ROWTYPE;
  game_number_value INTEGER;
  opponent_id UUID;
  current_a INTEGER;
  current_b INTEGER;
  format_value public.scoring_format;
BEGIN
  IF actor IS NULL OR NOT (SELECT private.is_authorized_match_operator(match_uuid)) THEN
    RAISE EXCEPTION 'You are not assigned to this match.'
      USING ERRCODE = '42501';
  END IF;

  IF card_value IS NULL THEN
    RAISE EXCEPTION 'A disciplinary card type is required.'
      USING ERRCODE = '22023';
  END IF;

  IF card_value = 'BLACK' AND NOT (SELECT private.is_committee_member()) THEN
    RAISE EXCEPTION 'Only a committee administrator can confirm a Black Card.'
      USING ERRCODE = '42501';
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

  SELECT category.format
  INTO format_value
  FROM public.categories AS category
  WHERE category.id = match_record.category_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Scoring category not found.'
      USING ERRCODE = 'P0002';
  END IF;

  IF NOT (SELECT private.is_authorized_match_operator(match_uuid)) THEN
    RAISE EXCEPTION 'You are not assigned to this match.'
      USING ERRCODE = '42501';
  END IF;

  IF match_record.status <> 'IN_PROGRESS' THEN
    RAISE EXCEPTION 'Cards can only be logged during an active match.'
      USING ERRCODE = 'P0001';
  END IF;

  IF player_uuid IS NOT NULL AND player_uuid NOT IN (match_record.player_a_id, match_record.player_b_id) THEN
    RAISE EXCEPTION 'The card player is not part of this match.'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.match_events (match_id, event_type, event_time, player_id, card)
  VALUES (match_uuid, 'DISCIPLINARY_CARD', now(), player_uuid, card_value)
  RETURNING * INTO event_record;

  IF card_value = 'RED' AND player_uuid IS NOT NULL THEN
    opponent_id := CASE
      WHEN player_uuid = match_record.player_a_id THEN match_record.player_b_id
      ELSE match_record.player_a_id
    END;

    SELECT game.game_number, game.player_a_score, game.player_b_score
    INTO game_number_value, current_a, current_b
    FROM public.match_games AS game
    WHERE game.match_id = match_uuid
      AND NOT (SELECT private.is_game_complete(format_value, game.player_a_score, game.player_b_score))
    ORDER BY game.game_number
    LIMIT 1
    FOR UPDATE;

    IF NOT FOUND THEN
      SELECT COALESCE(max(game.game_number), 0) + 1
      INTO game_number_value
      FROM public.match_games AS game
      WHERE game.match_id = match_uuid;

      current_a := 0;
      current_b := 0;
    END IF;

    IF game_number_value > (CASE WHEN format_value = 'SINGLE_SET_1X30' THEN 1 ELSE 3 END) THEN
      RAISE EXCEPTION 'A point penalty cannot be applied after the match is complete.'
        USING ERRCODE = 'P0001';
    END IF;

    IF opponent_id = match_record.player_a_id THEN
      current_a := current_a + 1;
    ELSE
      current_b := current_b + 1;
    END IF;

    IF NOT (SELECT private.is_valid_game_score(format_value, game_number_value, current_a, current_b)) THEN
      RAISE EXCEPTION 'The Red Card point would make the game score invalid.'
        USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.match_games (match_id, game_number, player_a_score, player_b_score)
    VALUES (match_uuid, game_number_value, current_a, current_b)
    ON CONFLICT (match_id, game_number) DO UPDATE
    SET player_a_score = EXCLUDED.player_a_score,
        player_b_score = EXCLUDED.player_b_score;
  END IF;

  INSERT INTO public.audit_logs (
    actor_id, action, entity_type, entity_id, original_data, new_data
  )
  VALUES (
    actor,
    'MATCH_DISCIPLINARY_CARD_LOGGED',
    'match',
    match_uuid,
    NULL,
    jsonb_build_object('card', card_value, 'player_id', player_uuid)
  );

  RETURN event_record;
END;
$$;

CREATE OR REPLACE FUNCTION public.override_match_result(
  match_uuid UUID,
  new_status_value public.match_status,
  new_winner_id UUID,
  scores_payload JSONB,
  reason_text TEXT
)
RETURNS TABLE (
  id UUID,
  status VARCHAR,
  winner_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor UUID := (SELECT auth.uid());
  match_record public.matches%ROWTYPE;
  tournament_record public.tournaments%ROWTYPE;
  format_value public.scoring_format;
  game_payload JSONB;
  old_status public.match_status;
  old_winner UUID;
  invalid_game_count INTEGER;
  score_count INTEGER;
  distinct_score_count INTEGER;
  score_numbers INTEGER[];
  override_completed_a INTEGER;
  override_completed_b INTEGER;
BEGIN
  IF actor IS NULL OR NOT (SELECT private.is_committee_member()) THEN
    RAISE EXCEPTION 'Only committee administrators can override a result.'
      USING ERRCODE = '42501';
  END IF;

  IF reason_text IS NULL OR length(trim(reason_text)) < 10 THEN
    RAISE EXCEPTION 'An override reason of at least 10 characters is required.'
      USING ERRCODE = '22023';
  END IF;

  IF new_status_value NOT IN ('COMPLETED', 'WALKOVER', 'RETIRED', 'CANCELLED', 'POSTPONED', 'IN_PROGRESS') THEN
    RAISE EXCEPTION 'That override status is not supported.'
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

  SELECT category.format
  INTO format_value
  FROM public.categories AS category
  WHERE category.id = match_record.category_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Scoring category not found.'
      USING ERRCODE = 'P0002';
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

  IF tournament_record.status IN ('COMPLETED', 'ARCHIVED')
     OR tournament_record.rankings_processed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Match results cannot be changed after rankings are published.'
      USING ERRCODE = 'P0001';
  END IF;

  IF new_winner_id IS NOT NULL AND new_winner_id NOT IN (match_record.player_a_id, match_record.player_b_id) THEN
    RAISE EXCEPTION 'The winner must be one of the match participants.'
      USING ERRCODE = '22023';
  END IF;

  IF new_status_value IN ('COMPLETED', 'WALKOVER', 'RETIRED') AND new_winner_id IS NULL THEN
    RAISE EXCEPTION 'A completed result requires a winner.'
      USING ERRCODE = '22023';
  END IF;

  IF new_status_value NOT IN ('COMPLETED', 'WALKOVER', 'RETIRED') AND new_winner_id IS NOT NULL THEN
    RAISE EXCEPTION 'A non-final match status cannot retain a winner.'
      USING ERRCODE = '22023';
  END IF;

  IF scores_payload IS NOT NULL AND jsonb_typeof(scores_payload) <> 'array' THEN
    RAISE EXCEPTION 'Override scores must be an array.'
      USING ERRCODE = '22023';
  END IF;

  IF new_status_value IN ('COMPLETED', 'WALKOVER', 'RETIRED')
     AND (scores_payload IS NULL OR jsonb_array_length(scores_payload) = 0) THEN
    RAISE EXCEPTION 'A finalized override must include game scores.'
      USING ERRCODE = '22023';
  END IF;

  IF scores_payload IS NOT NULL THEN
    SELECT count(*)
    INTO invalid_game_count
    FROM jsonb_array_elements(scores_payload) AS game(value)
    WHERE NOT (SELECT private.is_valid_game_score(
      format_value,
      (game.value ->> 'game_number')::INTEGER,
      (game.value ->> 'player_a_score')::INTEGER,
      (game.value ->> 'player_b_score')::INTEGER
    ));

    IF invalid_game_count > 0 THEN
      RAISE EXCEPTION 'One or more override scores are invalid.'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  IF new_status_value IN ('COMPLETED', 'WALKOVER', 'RETIRED') THEN
    WITH score_rows AS (
      SELECT
        (game.value ->> 'game_number')::INTEGER AS game_number,
        (game.value ->> 'player_a_score')::INTEGER AS player_a_score,
        (game.value ->> 'player_b_score')::INTEGER AS player_b_score
      FROM jsonb_array_elements(scores_payload) AS game(value)
    )
    SELECT
      count(*)::INTEGER,
      count(DISTINCT game_number)::INTEGER,
      coalesce(array_agg(game_number ORDER BY game_number), ARRAY[]::INTEGER[]),
      count(*) FILTER (
        WHERE (SELECT private.is_game_complete(format_value, player_a_score, player_b_score))
          AND player_a_score > player_b_score
      )::INTEGER,
      count(*) FILTER (
        WHERE (SELECT private.is_game_complete(format_value, player_a_score, player_b_score))
          AND player_b_score > player_a_score
      )::INTEGER
    INTO score_count, distinct_score_count, score_numbers, override_completed_a, override_completed_b
    FROM score_rows;

    IF score_count IS DISTINCT FROM distinct_score_count THEN
      RAISE EXCEPTION 'Override game numbers must be unique.'
        USING ERRCODE = '22023';
    END IF;

    IF format_value = 'SINGLE_SET_1X30' THEN
      IF score_numbers IS DISTINCT FROM ARRAY[1]::INTEGER[]
         OR override_completed_a + override_completed_b <> 1 THEN
        RAISE EXCEPTION 'A single-set override must contain one completed game.'
          USING ERRCODE = '22023';
      END IF;
    ELSIF NOT (
      (override_completed_a = 2 AND override_completed_b = 0 AND score_numbers = ARRAY[1, 2]::INTEGER[])
      OR (override_completed_a = 0 AND override_completed_b = 2 AND score_numbers = ARRAY[1, 2]::INTEGER[])
      OR (override_completed_a = 2 AND override_completed_b = 1 AND score_numbers = ARRAY[1, 2, 3]::INTEGER[])
      OR (override_completed_a = 1 AND override_completed_b = 2 AND score_numbers = ARRAY[1, 2, 3]::INTEGER[])
    ) THEN
      RAISE EXCEPTION 'A finalized override must contain a valid 2-0 or 2-1 game sequence.'
        USING ERRCODE = '22023';
    END IF;

    IF (new_winner_id = match_record.player_a_id AND override_completed_a <= override_completed_b)
       OR (new_winner_id = match_record.player_b_id AND override_completed_b <= override_completed_a) THEN
      RAISE EXCEPTION 'The winner must agree with the completed game scores.'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  old_status := match_record.status;
  old_winner := match_record.winner_id;
  PERFORM private.adjust_group_standings(match_uuid, -1);

  IF scores_payload IS NOT NULL THEN
    DELETE FROM public.match_games WHERE match_id = match_uuid;
    FOR game_payload IN SELECT value FROM jsonb_array_elements(scores_payload)
    LOOP
      INSERT INTO public.match_games (match_id, game_number, player_a_score, player_b_score)
      VALUES (
        match_uuid,
        (game_payload ->> 'game_number')::INTEGER,
        (game_payload ->> 'player_a_score')::INTEGER,
        (game_payload ->> 'player_b_score')::INTEGER
      );
    END LOOP;
  END IF;

  UPDATE public.matches AS match
  SET status = new_status_value, winner_id = new_winner_id
  WHERE match.id = match_uuid
  RETURNING * INTO match_record;

  IF new_status_value IN ('COMPLETED', 'WALKOVER', 'RETIRED') THEN
    PERFORM private.adjust_group_standings(match_uuid, 1);
  END IF;
  PERFORM private.sync_tournament_status(match_record.category_id);

  INSERT INTO public.audit_logs (
    actor_id, action, entity_type, entity_id, original_data, new_data, reason
  )
  VALUES (
    actor,
    'MATCH_RESULT_OVERRIDDEN',
    'match',
    match_uuid,
    jsonb_build_object('status', old_status, 'winner_id', old_winner),
    jsonb_build_object('status', new_status_value, 'winner_id', new_winner_id, 'scores', scores_payload),
    reason_text
  );

  RETURN QUERY SELECT match_uuid, new_status_value::VARCHAR, new_winner_id;
END;
$$;

REVOKE ALL ON FUNCTION private.is_valid_game_score(public.scoring_format, INTEGER, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.is_game_complete(public.scoring_format, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.is_authorized_match_operator(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.adjust_group_standings(UUID, INTEGER) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.is_authorized_match_operator(UUID) TO authenticated;

-- Supabase's default Data API grants are removed explicitly from exposed
-- SECURITY DEFINER functions; only authenticated callers may invoke them.
REVOKE ALL ON FUNCTION public.start_match(UUID) FROM anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.record_game_score(UUID, INTEGER, INTEGER, INTEGER) FROM anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.submit_match_result(UUID) FROM anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.log_disciplinary_card(UUID, public.disciplinary_card, UUID) FROM anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.override_match_result(UUID, public.match_status, UUID, JSONB, TEXT) FROM anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.start_match(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_game_score(UUID, INTEGER, INTEGER, INTEGER) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.submit_match_result(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.log_disciplinary_card(UUID, public.disciplinary_card, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.override_match_result(UUID, public.match_status, UUID, JSONB, TEXT) TO authenticated, service_role;

-- Match score/event rows remain readable to authenticated users, but all writes
-- go through the verified functions above.
REVOKE INSERT, UPDATE, DELETE ON public.match_games FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.match_events FROM anon, authenticated;
