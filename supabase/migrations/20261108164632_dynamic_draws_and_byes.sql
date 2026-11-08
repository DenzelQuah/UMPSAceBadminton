BEGIN;

ALTER TABLE public.categories ADD COLUMN draw_format TEXT NOT NULL DEFAULT 'ROUND_ROBIN' CHECK(draw_format IN ('ROUND_ROBIN','SINGLE_ELIMINATION')),
  ADD COLUMN target_group_size INTEGER NOT NULL DEFAULT 4 CHECK(target_group_size BETWEEN 2 AND 1000);
-- Existing categories retain their intended group size, not a required turnout.
UPDATE public.categories c SET target_group_size=greatest(2,ceil(c.max_capacity::NUMERIC/c.group_count)::INTEGER)
WHERE c.status NOT IN ('COMPLETED','ARCHIVED') AND EXISTS(
  SELECT 1 FROM public.tournaments t WHERE t.id=c.tournament_id AND t.status NOT IN ('COMPLETED','ARCHIVED')
);
REVOKE UPDATE(draw_format,target_group_size) ON public.categories FROM anon,authenticated;

CREATE FUNCTION private.dynamic_group_count(entry_count INTEGER,target_size INTEGER,qualifiers INTEGER) RETURNS INTEGER
LANGUAGE SQL IMMUTABLE SET search_path='' AS $$
  SELECT greatest(1,least(64,ceil(entry_count::NUMERIC/target_size)::INTEGER,entry_count/greatest(2,qualifiers)));
$$;
REVOKE ALL ON FUNCTION private.dynamic_group_count(INTEGER,INTEGER,INTEGER) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.dynamic_draw_capability() RETURNS BOOLEAN LANGUAGE SQL STABLE SET search_path='' AS $$ SELECT auth.uid() IS NOT NULL; $$;
REVOKE ALL ON FUNCTION public.dynamic_draw_capability() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.dynamic_draw_capability() TO authenticated;

CREATE FUNCTION public.get_dynamic_tournament_categories(tournament_uuid UUID) RETURNS JSONB
LANGUAGE SQL STABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT coalesce(jsonb_agg(to_jsonb(entry)||jsonb_build_object('draw_format',c.draw_format,'target_group_size',c.target_group_size) ORDER BY c.created_at),'[]'::JSONB)
  FROM public.get_tournament_entry_categories(tournament_uuid) entry JOIN public.categories c ON c.id=entry.id;
$$;
REVOKE ALL ON FUNCTION public.get_dynamic_tournament_categories(UUID) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_dynamic_tournament_categories(UUID) TO authenticated;

CREATE FUNCTION public.create_dynamic_category(tournament_uuid UUID,category_name TEXT,category_capacity INTEGER,
  category_qualifier_count INTEGER,category_format public.scoring_format,entry_format TEXT,draw_format_value TEXT,target_group_size_value INTEGER)
RETURNS public.categories LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result public.categories%ROWTYPE;
BEGIN
  IF NOT private.is_committee_member() THEN RAISE EXCEPTION 'MT or administrator access required.' USING ERRCODE='42501'; END IF;
  IF draw_format_value IS NULL OR draw_format_value NOT IN ('ROUND_ROBIN','SINGLE_ELIMINATION')
    OR target_group_size_value IS NULL OR target_group_size_value NOT BETWEEN 2 AND 1000
    OR entry_format IS NULL OR entry_format NOT IN ('SINGLES','DOUBLES') THEN RAISE EXCEPTION 'Invalid draw settings.' USING ERRCODE='22023'; END IF;
  IF entry_format='DOUBLES' THEN
    SELECT * INTO result FROM public.create_doubles_category(tournament_uuid,category_name,category_capacity,1,category_qualifier_count,category_format);
  ELSE
    SELECT * INTO result FROM public.create_tournament_category(tournament_uuid,category_name,category_capacity,1,category_qualifier_count,category_format);
  END IF;
  UPDATE public.categories SET draw_format=draw_format_value,target_group_size=target_group_size_value WHERE id=result.id RETURNING * INTO result;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.create_dynamic_category(UUID,TEXT,INTEGER,INTEGER,public.scoring_format,TEXT,TEXT,INTEGER) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.create_dynamic_category(UUID,TEXT,INTEGER,INTEGER,public.scoring_format,TEXT,TEXT,INTEGER) TO authenticated;

-- Dynamic close/group preview and elimination implementations follow.

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

    IF confirmed_count < 2 THEN
      RAISE EXCEPTION 'At least two confirmed entries are required before closing registration.'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF next_status='REGISTRATION_CLOSED' THEN
    UPDATE public.categories SET group_count=CASE WHEN draw_format='SINGLE_ELIMINATION' THEN 1 ELSE private.dynamic_group_count(confirmed_count,target_group_size,qualifiers_per_group) END WHERE id=category_uuid;
    UPDATE public.categories SET qualifiers_per_group=least(qualifiers_per_group,confirmed_count/group_count) WHERE id=category_uuid;
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

  IF category_record.draw_format <> 'ROUND_ROBIN' THEN RAISE EXCEPTION 'Use an elimination bracket for this category.' USING ERRCODE='22023'; END IF;
  IF confirmed_count < 2 THEN RAISE EXCEPTION 'At least two confirmed entries are required.' USING ERRCODE='22023'; END IF;
  category_record.group_count:=private.dynamic_group_count(confirmed_count,category_record.target_group_size,category_record.qualifiers_per_group);
  UPDATE public.categories SET group_count=category_record.group_count,qualifiers_per_group=least(qualifiers_per_group,confirmed_count/category_record.group_count) WHERE id=category_uuid;
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


CREATE OR REPLACE FUNCTION public.save_category_knockout_preview(category_uuid UUID,qualifier_count_value INTEGER,bracket_payload_value JSONB)
RETURNS public.category_knockout_previews LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE category_record public.categories%ROWTYPE; result public.category_knockout_previews%ROWTYPE;
  expected_ids UUID[]; actual_ids UUID[]; first_ids UUID[]; n INTEGER; bracket_size INTEGER:=2; round_count INTEGER:=1;
  round_index INTEGER; pairing_index INTEGER; round_value JSONB; pairing JSONB; pair_count INTEGER; byes INTEGER;
BEGIN
  IF auth.uid() IS NULL OR NOT private.is_committee_member() THEN RAISE EXCEPTION 'MT or administrator access required.' USING ERRCODE='42501'; END IF;
  SELECT * INTO category_record FROM public.categories WHERE id=category_uuid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Category not found.' USING ERRCODE='P0002'; END IF;
  IF category_record.draw_format='SINGLE_ELIMINATION' THEN
    IF category_record.status NOT IN ('REGISTRATION_CLOSED','DRAW_PREPARATION','DRAW_GENERATED') THEN RAISE EXCEPTION 'Close registration before preparing an elimination bracket.' USING ERRCODE='P0001'; END IF;
    SELECT array_agg(r.player_id ORDER BY r.player_id) INTO expected_ids FROM public.registrations r WHERE r.category_id=category_uuid AND r.status='CONFIRMED';
  ELSE
    IF category_record.status NOT IN ('DRAW_PUBLISHED','GROUP_STAGE_IN_PROGRESS','GROUP_STAGE_COMPLETED')
      OR NOT EXISTS(SELECT 1 FROM public.matches WHERE category_id=category_uuid AND group_id IS NOT NULL)
      OR EXISTS(SELECT 1 FROM public.matches WHERE category_id=category_uuid AND group_id IS NOT NULL AND status NOT IN ('COMPLETED','WALKOVER','RETIRED')) THEN
      RAISE EXCEPTION 'Finalize all group matches before preparing a knockout bracket.' USING ERRCODE='P0001'; END IF;
    IF EXISTS(
      WITH boundary AS (
        SELECT row_number() OVER w AS place,
          ARRAY[m.standings_points,m.net_points,m.matches_won,m.matches_lost,m.points_won] AS stats,
          lead(ARRAY[m.standings_points,m.net_points,m.matches_won,m.matches_lost,m.points_won]) OVER w AS next_stats
        FROM public.group_members m JOIN public.groups g ON g.id=m.group_id WHERE g.category_id=category_uuid
        WINDOW w AS(PARTITION BY m.group_id ORDER BY m.standings_points DESC,m.net_points DESC,m.matches_won DESC,m.matches_lost,m.points_won DESC,m.player_id)
      ) SELECT 1 FROM boundary WHERE place=category_record.qualifiers_per_group AND stats=next_stats
    ) THEN RAISE EXCEPTION 'Resolve the tie at the qualification boundary before preparing the bracket.' USING ERRCODE='22023'; END IF;
    WITH ranked AS (
      SELECT m.player_id,row_number() OVER(PARTITION BY m.group_id ORDER BY m.standings_points DESC,m.net_points DESC,m.matches_won DESC,m.matches_lost,m.points_won DESC,m.player_id) AS place
      FROM public.group_members m JOIN public.groups g ON g.id=m.group_id WHERE g.category_id=category_uuid
    ) SELECT array_agg(player_id ORDER BY player_id) INTO expected_ids FROM ranked WHERE place<=category_record.qualifiers_per_group;
  END IF;
  n:=coalesce(cardinality(expected_ids),0);
  IF n<2 OR qualifier_count_value IS DISTINCT FROM n THEN RAISE EXCEPTION 'The bracket must use the actual eligible entry count (at least two).' USING ERRCODE='22023'; END IF;
  IF EXISTS(SELECT 1 FROM public.category_knockout_previews WHERE category_id=category_uuid AND status='PUBLISHED') THEN RAISE EXCEPTION 'This bracket is already published.' USING ERRCODE='P0001'; END IF;
  WHILE bracket_size<n LOOP bracket_size:=bracket_size*2; round_count:=round_count+1; END LOOP;
  IF bracket_payload_value IS NULL OR jsonb_typeof(bracket_payload_value)<>'object'
    OR jsonb_typeof(bracket_payload_value->'seeds') IS DISTINCT FROM 'array'
    OR jsonb_typeof(bracket_payload_value->'rounds') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Malformed bracket proposal.' USING ERRCODE='22023'; END IF;
  IF (bracket_payload_value->>'qualifier_count')::INTEGER IS DISTINCT FROM n
    OR coalesce((bracket_payload_value->>'bracket_size')::INTEGER,bracket_size)<>bracket_size
    OR coalesce((bracket_payload_value->>'bye_count')::INTEGER,bracket_size-n)<>bracket_size-n
    OR jsonb_array_length(bracket_payload_value->'seeds')<>n OR jsonb_array_length(bracket_payload_value->'rounds')<>round_count THEN
    RAISE EXCEPTION 'Bracket dimensions do not match the eligible field.' USING ERRCODE='22023'; END IF;
  SELECT array_agg((s.value->>'player_id')::UUID ORDER BY (s.value->>'player_id')::UUID) INTO actual_ids FROM jsonb_array_elements(bracket_payload_value->'seeds') s(value);
  IF actual_ids IS DISTINCT FROM expected_ids OR EXISTS(SELECT 1 FROM jsonb_array_elements(bracket_payload_value->'seeds') WITH ORDINALITY s(value,position) WHERE (s.value->>'seed')::INTEGER IS DISTINCT FROM s.position) THEN
    RAISE EXCEPTION 'Every eligible entry must have exactly one sequential seed.' USING ERRCODE='22023'; END IF;
  FOR round_index IN 0..round_count-1 LOOP
    round_value:=bracket_payload_value->'rounds'->round_index;
    pair_count:=bracket_size/(2^(round_index+1))::INTEGER;
    IF (round_value->>'round')::INTEGER IS DISTINCT FROM round_index+1 OR char_length(coalesce(round_value->>'label','')) NOT BETWEEN 1 AND 32
      OR jsonb_typeof(round_value->'pairings') IS DISTINCT FROM 'array' OR jsonb_array_length(round_value->'pairings')<>pair_count THEN
      RAISE EXCEPTION 'Malformed bracket round.' USING ERRCODE='22023'; END IF;
    FOR pairing_index IN 0..pair_count-1 LOOP
      pairing:=round_value->'pairings'->pairing_index;
      IF (pairing->>'index')::INTEGER IS DISTINCT FROM pairing_index+1 OR pairing->>'match_id' IS NOT NULL OR pairing->>'winner_id' IS NOT NULL THEN
        RAISE EXCEPTION 'Bracket positions must be sequential and unpublished.' USING ERRCODE='22023'; END IF;
      IF round_index=0 THEN
        IF pairing->>'player_a_id' IS NULL OR pairing->'source_pairing_indexes' IS DISTINCT FROM '[]'::JSONB
          OR (pairing->>'player_a_id')=(pairing->>'player_b_id')
          OR (pairing->>'player_b_id' IS NULL AND pairing->>'bye_player_id' IS DISTINCT FROM pairing->>'player_a_id')
          OR (pairing->>'player_b_id' IS NOT NULL AND pairing->>'bye_player_id' IS NOT NULL) THEN
          RAISE EXCEPTION 'A first-round slot needs two different entries or one explicit bye.' USING ERRCODE='22023'; END IF;
      ELSE
        IF pairing->>'player_a_id' IS NOT NULL OR pairing->>'player_b_id' IS NOT NULL OR pairing->>'bye_player_id' IS NOT NULL
          OR pairing->'source_pairing_indexes' IS DISTINCT FROM jsonb_build_array(pairing_index*2+1,pairing_index*2+2) THEN
          RAISE EXCEPTION 'Later rounds must use their two preceding source pairings.' USING ERRCODE='22023'; END IF;
      END IF;
    END LOOP;
  END LOOP;
  SELECT array_agg(player_id ORDER BY player_id) INTO first_ids FROM (
    SELECT (p.value->>'player_a_id')::UUID AS player_id FROM jsonb_array_elements(bracket_payload_value->'rounds'->0->'pairings') p(value)
    UNION ALL SELECT (p.value->>'player_b_id')::UUID FROM jsonb_array_elements(bracket_payload_value->'rounds'->0->'pairings') p(value) WHERE p.value->>'player_b_id' IS NOT NULL
  ) entries;
  SELECT count(*) INTO byes FROM jsonb_array_elements(bracket_payload_value->'rounds'->0->'pairings') p(value) WHERE p.value->>'bye_player_id' IS NOT NULL;
  IF first_ids IS DISTINCT FROM expected_ids OR byes<>bracket_size-n THEN RAISE EXCEPTION 'First round must cover every entry exactly once with the required number of byes.' USING ERRCODE='22023'; END IF;
  bracket_payload_value:=bracket_payload_value||jsonb_build_object('bracket_size',bracket_size,'bye_count',byes);
  INSERT INTO public.category_knockout_previews(category_id,qualifier_count,bracket_payload,status,generated_by)
    VALUES(category_uuid,n,bracket_payload_value,'READY',auth.uid()) ON CONFLICT(category_id) DO UPDATE
    SET qualifier_count=EXCLUDED.qualifier_count,bracket_payload=EXCLUDED.bracket_payload,status='READY',generated_by=auth.uid(),generated_at=now(),published_by=NULL,published_at=NULL,updated_at=now() RETURNING * INTO result;
  UPDATE public.categories SET status=CASE WHEN draw_format='SINGLE_ELIMINATION' THEN 'DRAW_GENERATED'::public.tournament_status ELSE 'GROUP_STAGE_COMPLETED'::public.tournament_status END WHERE id=category_uuid;
  PERFORM private.sync_tournament_status(category_uuid);
  INSERT INTO public.audit_logs(actor_id,action,entity_type,entity_id,new_data) VALUES(auth.uid(),'KNOCKOUT_PREVIEW_GENERATED','category_knockout_preview',result.id,jsonb_build_object('entries',n,'bracket_size',bracket_size,'byes',byes));
  RETURN result;
END;
$$;

-- Materialize only real pairs. Byes are bracket outcomes, never fabricated
-- walkovers, score events, ranking wins or fixtures against a fake player.
CREATE FUNCTION private.materialize_dynamic_bracket(category_uuid UUID) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE preview public.category_knockout_previews%ROWTYPE; rounds JSONB; pairings JSONB; pairing JSONB; sources JSONB;
  r INTEGER; p INTEGER; side INTEGER; source_index INTEGER; source_pair JSONB; winner UUID; a UUID; b UUID; created UUID;
BEGIN
  SELECT * INTO preview FROM public.category_knockout_previews WHERE category_id=category_uuid AND status='PUBLISHED' FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  rounds:=preview.bracket_payload->'rounds';
  FOR r IN 0..jsonb_array_length(rounds)-1 LOOP
    pairings:=rounds->r->'pairings';
    FOR p IN 0..jsonb_array_length(pairings)-1 LOOP
      pairing:=pairings->p;
      IF pairing->>'bye_player_id' IS NOT NULL THEN CONTINUE; END IF;
      IF r>0 THEN
        sources:=pairing->'source_pairing_indexes';
        FOR side IN 0..1 LOOP
          source_index:=(sources->>side)::INTEGER-1;
          source_pair:=rounds->(r-1)->'pairings'->source_index;
          winner:=NULL;
          IF source_pair->>'bye_player_id' IS NOT NULL THEN winner:=(source_pair->>'bye_player_id')::UUID;
          ELSIF source_pair->>'match_id' IS NOT NULL THEN
            SELECT winner_id INTO winner FROM public.matches WHERE id=(source_pair->>'match_id')::UUID AND status IN ('COMPLETED','WALKOVER','RETIRED');
          END IF;
          pairing:=jsonb_set(pairing,ARRAY[CASE WHEN side=0 THEN 'player_a_id' ELSE 'player_b_id' END],coalesce(to_jsonb(winner::TEXT),'null'::JSONB),true);
        END LOOP;
      END IF;
      a:=(pairing->>'player_a_id')::UUID; b:=(pairing->>'player_b_id')::UUID;
      IF a IS NOT NULL AND b IS NOT NULL AND pairing->>'match_id' IS NULL THEN
        IF a=b THEN RAISE EXCEPTION 'A bracket cannot pair an entry against itself.' USING ERRCODE='22023'; END IF;
        INSERT INTO public.matches(category_id,group_id,knockout_round,knockout_stage,player_a_id,player_b_id,status)
          VALUES(category_uuid,NULL,r+1,rounds->r->>'label',a,b,'SCHEDULED') RETURNING id INTO created;
        pairing:=jsonb_set(pairing,'{match_id}',to_jsonb(created::TEXT),true);
        INSERT INTO public.audit_logs(actor_id,action,entity_type,entity_id,new_data)
          VALUES(auth.uid(),CASE WHEN r=0 THEN 'KNOCKOUT_MATCH_CREATED' ELSE 'KNOCKOUT_MATCH_ADVANCED' END,'match',created,
            jsonb_build_object('category_id',category_uuid,'knockout_round',r+1,'player_a_id',a,'player_b_id',b,'source_pairing_indexes',pairing->'source_pairing_indexes'));
      END IF;
      pairings:=jsonb_set(pairings,ARRAY[p::TEXT],pairing,true);
    END LOOP;
    rounds:=jsonb_set(rounds,ARRAY[r::TEXT,'pairings'],pairings,true);
  END LOOP;
  UPDATE public.category_knockout_previews SET bracket_payload=jsonb_set(preview.bracket_payload,'{rounds}',rounds,true),updated_at=now() WHERE id=preview.id;
END;
$$;
REVOKE ALL ON FUNCTION private.materialize_dynamic_bracket(UUID) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.publish_category_knockout_bracket(category_uuid UUID) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE category_record public.categories%ROWTYPE; preview public.category_knockout_previews%ROWTYPE; created_matches JSONB;
BEGIN
  IF auth.uid() IS NULL OR NOT private.is_committee_member() THEN RAISE EXCEPTION 'MT or administrator access required.' USING ERRCODE='42501'; END IF;
  SELECT * INTO category_record FROM public.categories WHERE id=category_uuid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Category not found.' USING ERRCODE='P0002'; END IF;
  SELECT * INTO preview FROM public.category_knockout_previews WHERE category_id=category_uuid AND status='READY' FOR UPDATE;
  IF NOT FOUND OR EXISTS(SELECT 1 FROM public.matches WHERE category_id=category_uuid AND knockout_round IS NOT NULL) THEN RAISE EXCEPTION 'An unpublished bracket proposal is required.' USING ERRCODE='P0001'; END IF;
  -- Revalidate the locked roster, round graph and group completion before publishing.
  PERFORM public.save_category_knockout_preview(category_uuid,preview.qualifier_count,preview.bracket_payload);
  UPDATE public.category_knockout_previews SET status='PUBLISHED',published_by=auth.uid(),published_at=now(),updated_at=now() WHERE id=preview.id;
  UPDATE public.categories SET status='KNOCKOUT_IN_PROGRESS' WHERE id=category_uuid;
  PERFORM private.materialize_dynamic_bracket(category_uuid);
  PERFORM private.sync_tournament_status(category_uuid);
  SELECT coalesce(jsonb_agg(jsonb_build_object('match_id',id,'player_a_id',player_a_id,'player_b_id',player_b_id)),'[]'::JSONB) INTO created_matches FROM public.matches WHERE category_id=category_uuid AND knockout_round IS NOT NULL;
  INSERT INTO public.audit_logs(actor_id,action,entity_type,entity_id,new_data) VALUES(auth.uid(),'KNOCKOUT_BRACKET_PUBLISHED','category_knockout_preview',preview.id,jsonb_build_object('status','PUBLISHED','entries',preview.qualifier_count));
  RETURN jsonb_build_object('category_id',category_uuid,'status','PUBLISHED','matches',created_matches);
END;
$$;

CREATE OR REPLACE FUNCTION private.advance_knockout_bracket(match_uuid UUID) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE match_record public.matches%ROWTYPE;
BEGIN
  SELECT * INTO match_record FROM public.matches WHERE id=match_uuid;
  IF NOT FOUND OR match_record.knockout_round IS NULL OR match_record.status NOT IN ('COMPLETED','WALKOVER','RETIRED') OR match_record.winner_id IS NULL THEN RETURN; END IF;
  PERFORM 1 FROM public.categories WHERE id=match_record.category_id FOR UPDATE;
  PERFORM private.materialize_dynamic_bracket(match_record.category_id);
END;
$$;

-- Support cancel/reopen for an unpublished direct elimination draw too.
CREATE OR REPLACE FUNCTION public.cancel_category_draw_preview(category_uuid UUID) RETURNS VARCHAR
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE state public.tournament_status;
BEGIN
  IF NOT private.is_committee_member() THEN RAISE EXCEPTION 'MT or administrator access required.' USING ERRCODE='42501'; END IF;
  SELECT status INTO state FROM public.categories WHERE id=category_uuid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Category not found.' USING ERRCODE='P0002'; END IF;
  IF state NOT IN ('DRAW_PREPARATION','DRAW_GENERATED') OR EXISTS(SELECT 1 FROM public.matches WHERE category_id=category_uuid) OR EXISTS(SELECT 1 FROM public.groups WHERE category_id=category_uuid) THEN
    RAISE EXCEPTION 'Only an unpublished draw can be cancelled.' USING ERRCODE='P0001'; END IF;
  DELETE FROM public.category_draw_previews WHERE category_id=category_uuid;
  DELETE FROM public.category_knockout_previews WHERE category_id=category_uuid AND status<>'PUBLISHED';
  UPDATE public.categories SET status='REGISTRATION_CLOSED' WHERE id=category_uuid;
  PERFORM private.sync_tournament_status(category_uuid);
  INSERT INTO public.audit_logs(actor_id,action,entity_type,entity_id,new_data) VALUES(auth.uid(),'DRAW_PREVIEW_CANCELLED','category',category_uuid,jsonb_build_object('status','REGISTRATION_CLOSED'));
  RETURN 'REGISTRATION_CLOSED';
END;
$$;

ALTER TABLE public.matches ADD COLUMN group_round INTEGER CHECK(group_round IS NULL OR group_round>=1);
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
  created_match_count INTEGER; slots UUID[]; round_number INTEGER; slot_number INTEGER;
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

  PERFORM public.save_category_draw_preview(category_uuid,preview_record.groups_payload);
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

  created_match_count:=0;
  FOR group_payload IN SELECT value FROM jsonb_array_elements(preview_record.groups_payload) LOOP
    SELECT id INTO created_group_id FROM public.groups WHERE category_id=category_uuid AND name=group_payload->>'name';
    SELECT array_agg((p.value->>'id')::UUID ORDER BY p.ordinality) INTO slots FROM jsonb_array_elements(group_payload->'players') WITH ORDINALITY p(value,ordinality);
    IF cardinality(slots)%2=1 THEN slots:=array_append(slots,NULL::UUID); END IF;
    FOR round_number IN 1..cardinality(slots)-1 LOOP
      FOR slot_number IN 1..cardinality(slots)/2 LOOP
        IF slots[slot_number] IS NOT NULL AND slots[cardinality(slots)-slot_number+1] IS NOT NULL THEN
          INSERT INTO public.matches(category_id,group_id,group_round,player_a_id,player_b_id,status)
            VALUES(category_uuid,created_group_id,round_number,slots[slot_number],slots[cardinality(slots)-slot_number+1],'SCHEDULED');
          created_match_count:=created_match_count+1;
        END IF;
      END LOOP;
      slots:=ARRAY[slots[1],slots[cardinality(slots)]]||slots[2:cardinality(slots)-1];
    END LOOP;
  END LOOP;

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


COMMIT;
