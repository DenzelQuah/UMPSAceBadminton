BEGIN;

-- User-approved doubles pairing. An entry is represented by player_id throughout
-- the existing draw/standings engine; partner_id is an equally participating athlete.
ALTER TABLE public.categories ADD COLUMN participation_format TEXT NOT NULL DEFAULT 'SINGLES'
  CHECK (participation_format IN ('SINGLES', 'DOUBLES'));
ALTER TABLE public.registrations ADD COLUMN partner_id UUID REFERENCES public.profiles(id) ON DELETE RESTRICT;
ALTER TABLE public.registrations ADD CONSTRAINT distinct_doubles_partner CHECK (partner_id <> player_id);
CREATE INDEX registrations_partner_idx ON public.registrations(partner_id, category_id);
ALTER TABLE public.matches ADD COLUMN player_a_partner_id UUID REFERENCES public.profiles(id) ON DELETE RESTRICT;
ALTER TABLE public.matches ADD COLUMN player_b_partner_id UUID REFERENCES public.profiles(id) ON DELETE RESTRICT;

CREATE TABLE public.tournament_squad_members (
  tournament_id UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  PRIMARY KEY (tournament_id, profile_id)
);
ALTER TABLE public.tournament_squad_members ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tournament_squad_members FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.tournament_squad_members TO authenticated;
CREATE POLICY squad_read ON public.tournament_squad_members FOR SELECT TO authenticated
  USING (private.is_tournament_visible_to_current_user(tournament_id));

CREATE TABLE public.doubles_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  inviter_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  partner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (inviter_id <> partner_id)
);
ALTER TABLE public.doubles_invitations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.doubles_invitations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.doubles_invitations TO authenticated;
CREATE INDEX doubles_invitations_participants_idx ON public.doubles_invitations(category_id, status, inviter_id, partner_id);
CREATE POLICY invitation_read ON public.doubles_invitations FOR SELECT TO authenticated
  USING (auth.uid() IN (inviter_id, partner_id) OR private.is_committee_member());

-- Functions use definer rights only to execute atomic operations over protected
-- tables. Every public mutation checks the current actor; none trust client roles.
CREATE FUNCTION private.competitor_members(category_uuid UUID, representative UUID)
RETURNS UUID[] LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT array_remove(ARRAY[representative, (
    SELECT r.partner_id FROM public.registrations r
    WHERE r.category_id = category_uuid AND r.player_id = representative AND r.status <> 'WITHDRAWN'
  )], NULL);
$$;
CREATE FUNCTION private.competitor_name(category_uuid UUID, representative UUID)
RETURNS TEXT LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT string_agg(p.full_name, ' / ' ORDER BY participant.ordinality)
  FROM unnest(private.competitor_members(category_uuid, representative)) WITH ORDINALITY participant(id, ordinality)
  JOIN public.profiles p ON p.id = participant.id;
$$;
REVOKE ALL ON FUNCTION private.competitor_members(UUID, UUID), private.competitor_name(UUID, UUID) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.set_tournament_squad_member(tournament_uuid UUID, profile_uuid UUID, enabled BOOLEAN)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE previous_status BOOLEAN;
BEGIN
  IF NOT private.is_committee_member() THEN RAISE EXCEPTION 'Administrator access required.' USING ERRCODE = '42501'; END IF;
  PERFORM 1 FROM public.tournaments WHERE id = tournament_uuid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tournament not found.' USING ERRCODE = 'P0002'; END IF;
  -- Tournament -> category -> invitation/registration is the shared lock order.
  PERFORM 1 FROM public.categories WHERE tournament_id = tournament_uuid ORDER BY id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.tournaments WHERE id = tournament_uuid AND status IN ('COMPLETED', 'ARCHIVED'))
     OR EXISTS (SELECT 1 FROM public.categories WHERE tournament_id = tournament_uuid AND status NOT IN ('DRAFT', 'REGISTRATION_OPEN')) THEN
    RAISE EXCEPTION 'The squad roster freezes when registration closes.' USING ERRCODE = 'P0001';
  END IF;
  IF enabled IS NULL THEN RAISE EXCEPTION 'Choose a squad status.' USING ERRCODE = '22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = profile_uuid) THEN
    RAISE EXCEPTION 'Player profile not found.' USING ERRCODE = 'P0002'; END IF;
  SELECT EXISTS (SELECT 1 FROM public.tournament_squad_members WHERE tournament_id = tournament_uuid AND profile_id = profile_uuid)
    INTO previous_status;
  IF enabled AND EXISTS (
    SELECT 1 FROM public.registrations r JOIN public.categories c ON c.id = r.category_id
    WHERE c.tournament_id = tournament_uuid AND r.status <> 'WITHDRAWN'
    AND (r.player_id = profile_uuid OR r.partner_id = profile_uuid)
    AND EXISTS (SELECT 1 FROM public.tournament_squad_members s WHERE s.tournament_id = tournament_uuid
      AND s.profile_id = CASE WHEN r.player_id = profile_uuid THEN r.partner_id ELSE r.player_id END)
  ) THEN RAISE EXCEPTION 'This change would put two main-squad players in an existing pair.' USING ERRCODE = '22023'; END IF;
  IF enabled THEN
    INSERT INTO public.tournament_squad_members VALUES (tournament_uuid, profile_uuid) ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM public.tournament_squad_members WHERE tournament_id = tournament_uuid AND profile_id = profile_uuid;
  END IF;
  INSERT INTO public.audit_logs(actor_id, action, entity_type, entity_id, original_data, new_data)
    VALUES (auth.uid(), 'MAIN_SQUAD_UPDATED', 'tournament', tournament_uuid,
      jsonb_build_object('profile_id', profile_uuid, 'enabled', previous_status),
      jsonb_build_object('profile_id', profile_uuid, 'enabled', enabled));
END;
$$;

CREATE FUNCTION public.create_doubles_category(
  tournament_uuid UUID, category_name TEXT, category_capacity INTEGER,
  category_group_count INTEGER, category_qualifier_count INTEGER, category_format public.scoring_format
) RETURNS public.categories LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE result public.categories%ROWTYPE;
BEGIN
  IF NOT private.is_committee_member() THEN RAISE EXCEPTION 'Administrator access required.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO result FROM public.create_tournament_category(tournament_uuid, category_name,
    category_capacity, category_group_count, category_qualifier_count, category_format);
  UPDATE public.categories SET participation_format = 'DOUBLES' WHERE id = result.id RETURNING * INTO result;
  RETURN result;
END;
$$;

CREATE FUNCTION private.guard_pair_registration()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE category_record public.categories%ROWTYPE;
BEGIN
  SELECT * INTO category_record FROM public.categories WHERE id = NEW.category_id FOR UPDATE;
  IF TG_OP = 'UPDATE' AND (NEW.player_id IS DISTINCT FROM OLD.player_id OR NEW.partner_id IS DISTINCT FROM OLD.partner_id
      OR NEW.category_id IS DISTINCT FROM OLD.category_id) AND category_record.status <> 'REGISTRATION_OPEN' THEN
    RAISE EXCEPTION 'Pair membership is locked after registration closes.' USING ERRCODE = 'P0001';
  END IF;
  IF category_record.participation_format = 'DOUBLES' AND NEW.partner_id IS NULL THEN
    RAISE EXCEPTION 'Doubles requires an accepted partner invitation.' USING ERRCODE = '22023';
  ELSIF category_record.participation_format = 'SINGLES' AND NEW.partner_id IS NOT NULL THEN
    RAISE EXCEPTION 'Singles entries cannot contain a partner.' USING ERRCODE = '22023';
  END IF;
  IF NEW.status <> 'WITHDRAWN' THEN
    IF EXISTS (SELECT 1 FROM public.registrations r WHERE r.category_id = NEW.category_id
      AND r.id <> NEW.id AND r.status <> 'WITHDRAWN'
      AND ARRAY[r.player_id, r.partner_id] && array_remove(ARRAY[NEW.player_id, NEW.partner_id], NULL)) THEN
      RAISE EXCEPTION 'A player already belongs to another entry in this category.' USING ERRCODE = '23505';
    END IF;
    IF NEW.partner_id IS NOT NULL AND 2 = (SELECT count(*) FROM public.tournament_squad_members s
      WHERE s.tournament_id = category_record.tournament_id AND s.profile_id IN (NEW.player_id, NEW.partner_id)) THEN
      RAISE EXCEPTION 'Two main-squad players cannot partner in this tournament.' USING ERRCODE = '22023';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER pair_registration_guard BEFORE INSERT OR UPDATE ON public.registrations
  FOR EACH ROW EXECUTE FUNCTION private.guard_pair_registration();
REVOKE ALL ON FUNCTION private.guard_pair_registration() FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.invite_doubles_partner(category_uuid UUID, partner_email TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE c public.categories%ROWTYPE; partner UUID; invitation UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in first.' USING ERRCODE = '42501'; END IF;
  -- Taking the tournament lock also serializes invitations against squad edits.
  PERFORM 1 FROM public.tournaments WHERE id = (SELECT tournament_id FROM public.categories WHERE id = category_uuid) FOR UPDATE;
  SELECT * INTO c FROM public.categories WHERE id = category_uuid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Category not found.' USING ERRCODE = 'P0002'; END IF;
  IF c.status <> 'REGISTRATION_OPEN' OR c.participation_format <> 'DOUBLES' THEN
    RAISE EXCEPTION 'Doubles registration must be open.' USING ERRCODE = 'P0001'; END IF;
  SELECT id INTO partner FROM public.profiles WHERE lower(email) = lower(trim(partner_email));
  IF partner IS NULL OR partner = auth.uid() THEN
    RAISE EXCEPTION 'Enter the email of another registered UMPSA account.' USING ERRCODE = '22023'; END IF;
  IF 2 = (SELECT count(*) FROM public.tournament_squad_members WHERE tournament_id = c.tournament_id
    AND profile_id IN (auth.uid(), partner)) THEN
    RAISE EXCEPTION 'Two main-squad players cannot partner in this tournament.' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM public.registrations r WHERE r.category_id = category_uuid AND r.status <> 'WITHDRAWN'
    AND ARRAY[r.player_id, r.partner_id] && ARRAY[auth.uid(), partner])
    OR EXISTS (SELECT 1 FROM public.doubles_invitations i WHERE i.category_id = category_uuid AND i.status = 'PENDING'
    AND ARRAY[i.inviter_id, i.partner_id] && ARRAY[auth.uid(), partner]) THEN
    RAISE EXCEPTION 'One of you already has an entry or pending invitation in this category.' USING ERRCODE = '23505'; END IF;
  INSERT INTO public.doubles_invitations(category_id, inviter_id, partner_id)
    VALUES(category_uuid, auth.uid(), partner) RETURNING id INTO invitation;
  RETURN invitation;
END;
$$;

CREATE FUNCTION public.respond_doubles_invitation(invitation_uuid UUID, response TEXT)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE i public.doubles_invitations%ROWTYPE; c public.categories%ROWTYPE; assigned public.registration_status;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in first.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO i FROM public.doubles_invitations WHERE id = invitation_uuid;
  IF NOT FOUND OR auth.uid() NOT IN (i.inviter_id, i.partner_id) THEN
    RAISE EXCEPTION 'This invitation is not yours.' USING ERRCODE = '42501'; END IF;
  PERFORM 1 FROM public.tournaments WHERE id = (SELECT tournament_id FROM public.categories WHERE id = i.category_id) FOR UPDATE;
  SELECT * INTO c FROM public.categories WHERE id = i.category_id FOR UPDATE;
  SELECT * INTO i FROM public.doubles_invitations WHERE id = invitation_uuid FOR UPDATE;
  IF c.status <> 'REGISTRATION_OPEN' OR i.status <> 'PENDING' THEN
    RAISE EXCEPTION 'This invitation is no longer available.' USING ERRCODE = 'P0001'; END IF;
  IF response IS NULL OR response NOT IN ('ACCEPT', 'DECLINE', 'CANCEL') THEN
    RAISE EXCEPTION 'Choose accept, decline or cancel.' USING ERRCODE = '22023'; END IF;
  IF (response IN ('ACCEPT', 'DECLINE') AND auth.uid() <> i.partner_id)
     OR (response = 'CANCEL' AND auth.uid() <> i.inviter_id) THEN
    RAISE EXCEPTION 'Only the partner can accept or decline; only the sender can cancel.' USING ERRCODE = '42501'; END IF;
  IF response = 'ACCEPT' THEN
    SELECT CASE WHEN count(*) < c.max_capacity THEN 'CONFIRMED'::public.registration_status ELSE 'WAITLISTED'::public.registration_status END
      INTO assigned FROM public.registrations WHERE category_id = c.id AND status = 'CONFIRMED';
    INSERT INTO public.registrations(category_id, player_id, partner_id, status)
      VALUES(c.id, i.inviter_id, i.partner_id, assigned)
      ON CONFLICT (category_id, player_id) DO UPDATE SET partner_id = EXCLUDED.partner_id,
        status = EXCLUDED.status, created_at = now(), seed_number = NULL
      WHERE public.registrations.status = 'WITHDRAWN';
    IF NOT FOUND THEN RAISE EXCEPTION 'This player already has an entry.' USING ERRCODE = '23505'; END IF;
    UPDATE public.doubles_invitations SET status = 'ACCEPTED' WHERE id = i.id;
  ELSE
    UPDATE public.doubles_invitations SET status = CASE response WHEN 'DECLINE' THEN 'DECLINED' ELSE 'CANCELLED' END WHERE id = i.id;
  END IF;
  INSERT INTO public.audit_logs(actor_id, action, entity_type, entity_id, original_data, new_data)
    VALUES(auth.uid(), 'DOUBLES_INVITATION_' || response, 'doubles_invitation', i.id,
      jsonb_build_object('status', i.status), jsonb_build_object('response', response, 'registration_status', assigned));
  RETURN coalesce(assigned::TEXT, response);
END;
$$;

CREATE OR REPLACE FUNCTION public.withdraw_registration(registration_uuid UUID)
RETURNS public.registrations LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.registrations%ROWTYPE; c public.categories%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in first.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO r FROM public.registrations WHERE id = registration_uuid;
  IF NOT FOUND OR NOT (auth.uid() = ANY(array_remove(ARRAY[r.player_id, r.partner_id], NULL))) THEN
    RAISE EXCEPTION 'Registration not found.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO c FROM public.categories WHERE id = r.category_id FOR UPDATE;
  IF c.status <> 'REGISTRATION_OPEN' THEN RAISE EXCEPTION 'Registration is closed.' USING ERRCODE = 'P0001'; END IF;
  UPDATE public.registrations SET status = 'WITHDRAWN' WHERE id = r.id RETURNING * INTO r;
  RETURN r;
END;
$$;

-- Safe read model used by both team members and published tournament viewers.
CREATE FUNCTION public.get_category_entries(category_ids UUID[])
RETURNS TABLE(category_id UUID, representative_id UUID, partner_id UUID, display_name TEXT)
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT r.category_id, r.player_id, r.partner_id, private.competitor_name(r.category_id, r.player_id)
  FROM public.registrations r WHERE auth.uid() IS NOT NULL AND r.category_id = ANY(category_ids)
    AND r.status <> 'WITHDRAWN' AND (private.is_committee_member() OR auth.uid() IN (r.player_id, r.partner_id)
      OR EXISTS (SELECT 1 FROM public.categories c WHERE c.id = r.category_id AND c.status IN
        ('DRAW_PUBLISHED','GROUP_STAGE_IN_PROGRESS','GROUP_STAGE_COMPLETED','KNOCKOUT_IN_PROGRESS','COMPLETED','ARCHIVED')));
$$;
CREATE FUNCTION public.get_my_registrations()
RETURNS SETOF public.registrations LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT r.* FROM public.registrations r WHERE auth.uid() IS NOT NULL AND auth.uid() IN (r.player_id, r.partner_id) ORDER BY r.created_at DESC;
$$;
CREATE FUNCTION public.get_tournament_entry_categories(tournament_uuid UUID)
RETURNS TABLE(id UUID, tournament_id UUID, name VARCHAR, max_capacity INTEGER, group_count INTEGER,
  qualifiers_per_group INTEGER, format public.scoring_format, status public.tournament_status,
  created_at TIMESTAMPTZ, confirmed_count INTEGER, waitlisted_count INTEGER, participation_format TEXT)
LANGUAGE SQL STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT g.*, c.participation_format FROM public.get_tournament_categories(tournament_uuid) g
  JOIN public.categories c ON c.id = g.id;
$$;
REVOKE ALL ON FUNCTION public.get_tournament_entry_categories(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_tournament_entry_categories(UUID) TO authenticated;
CREATE FUNCTION public.get_my_doubles_invitations(category_uuid UUID)
RETURNS TABLE(id UUID, inviter_id UUID, partner_id UUID, inviter_name VARCHAR, partner_name VARCHAR, status TEXT)
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT i.id, i.inviter_id, i.partner_id, a.full_name, b.full_name, i.status
  FROM public.doubles_invitations i JOIN public.profiles a ON a.id = i.inviter_id JOIN public.profiles b ON b.id = i.partner_id
  WHERE i.category_id = category_uuid AND auth.uid() IN (i.inviter_id, i.partner_id) AND i.status = 'PENDING';
$$;

CREATE FUNCTION private.guard_doubles_schedule()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE athletes UUID[]; other_athletes UUID[]; other public.matches%ROWTYPE; gap NUMERIC;
BEGIN
  NEW.player_a_partner_id := (private.competitor_members(NEW.category_id, NEW.player_a_id))[2];
  NEW.player_b_partner_id := (private.competitor_members(NEW.category_id, NEW.player_b_id))[2];
  athletes := private.competitor_members(NEW.category_id, NEW.player_a_id) || private.competitor_members(NEW.category_id, NEW.player_b_id);
  IF NEW.umpire_id = ANY(athletes) OR NEW.linesman_id = ANY(athletes) THEN
    RAISE EXCEPTION 'Neither doubles partner can officiate their own match.' USING ERRCODE = '22023'; END IF;
  IF NEW.scheduled_time IS NULL OR NEW.status IN ('CANCELLED', 'POSTPONED') THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('umpsace:match-scheduling', 0));
  FOR other IN SELECT * FROM public.matches WHERE id <> NEW.id AND scheduled_time IS NOT NULL AND status NOT IN ('CANCELLED','POSTPONED') LOOP
    gap := abs(extract(epoch FROM (NEW.scheduled_time - other.scheduled_time))) / 60;
    IF gap >= 70 THEN CONTINUE; END IF;
    other_athletes := private.competitor_members(other.category_id, other.player_a_id) || private.competitor_members(other.category_id, other.player_b_id);
    IF athletes && other_athletes AND gap < 60 THEN
      RAISE EXCEPTION 'Every doubles athlete needs 20 minutes rest after a 40-minute match slot.' USING ERRCODE = 'P0001'; END IF;
    IF athletes && array_remove(ARRAY[other.umpire_id, other.linesman_id], NULL)
       OR other_athletes && array_remove(ARRAY[NEW.umpire_id, NEW.linesman_id], NULL) THEN
      RAISE EXCEPTION 'Doubles athlete and official duties need a 70-minute start-time buffer.' USING ERRCODE = 'P0001'; END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
CREATE TRIGGER doubles_schedule_guard BEFORE INSERT OR UPDATE OF scheduled_time, umpire_id, linesman_id, player_a_id, player_b_id
  ON public.matches FOR EACH ROW EXECUTE FUNCTION private.guard_doubles_schedule();
REVOKE ALL ON FUNCTION private.guard_doubles_schedule() FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.set_tournament_squad_member(UUID, UUID, BOOLEAN),
  public.create_doubles_category(UUID, TEXT, INTEGER, INTEGER, INTEGER, public.scoring_format),
  public.invite_doubles_partner(UUID, TEXT), public.respond_doubles_invitation(UUID, TEXT),
  public.get_category_entries(UUID[]), public.get_my_registrations(), public.get_my_doubles_invitations(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_tournament_squad_member(UUID, UUID, BOOLEAN),
  public.create_doubles_category(UUID, TEXT, INTEGER, INTEGER, INTEGER, public.scoring_format),
  public.invite_doubles_partner(UUID, TEXT), public.respond_doubles_invitation(UUID, TEXT),
  public.get_category_entries(UUID[]), public.get_my_registrations(), public.get_my_doubles_invitations(UUID)
  TO authenticated;

-- Publish ranking points for both members of each accepted pair atomically.
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
  representative_id UUID;
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
    FOR representative_id, player_id IN
      SELECT side.representative, athlete.id
      FROM (VALUES (match_record.player_a_id), (match_record.player_b_id)) side(representative)
      CROSS JOIN LATERAL unnest(private.competitor_members(match_record.category_id, side.representative)) athlete(id)
    LOOP
      SELECT
        count(*) FILTER (
          WHERE (representative_id = match_record.player_a_id AND game.player_a_score > game.player_b_score)
             OR (representative_id = match_record.player_b_id AND game.player_b_score > game.player_a_score)
        ),
        coalesce(sum(CASE WHEN representative_id = match_record.player_a_id THEN game.player_a_score ELSE game.player_b_score END), 0),
        coalesce(sum(CASE WHEN representative_id = match_record.player_a_id THEN game.player_b_score ELSE game.player_a_score END), 0)
      INTO set_wins, points_won, points_lost
      FROM public.match_games AS game
      WHERE game.match_id = match_record.id;

      IF set_wins = 0 AND match_record.status = 'WALKOVER' AND representative_id = match_record.winner_id THEN
        set_wins := CASE
          WHEN EXISTS (
            SELECT 1 FROM public.categories AS category
            JOIN public.matches AS match ON match.category_id = category.id
            WHERE match.id = match_record.id
              AND category.format = 'STANDARD_3X21'
          ) THEN 2 ELSE 1
        END;
      END IF;

      win_bonus := CASE WHEN representative_id = match_record.winner_id THEN 3 ELSE 0 END;
      participation_bonus := CASE
        WHEN match_record.status = 'WALKOVER' AND representative_id <> match_record.winner_id THEN 0
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
        CASE WHEN representative_id = match_record.winner_id THEN 1 ELSE 0 END,
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


-- Preview names must describe the complete pair.
CREATE OR REPLACE FUNCTION private.validate_category_draw_preview()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  confirmed_count INTEGER;
  preview_count INTEGER;
  preview_distinct_count INTEGER;
  invalid_metadata_count INTEGER;
BEGIN
  IF jsonb_typeof(NEW.groups_payload) <> 'array' THEN
    RAISE EXCEPTION 'Preview groups must be an array.'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(NEW.groups_payload) AS group_payload(value)
    WHERE jsonb_typeof(group_payload.value -> 'players') <> 'array'
  ) THEN
    RAISE EXCEPTION 'Every preview group must contain a player array.'
      USING ERRCODE = '22023';
  END IF;

  SELECT count(*)::INTEGER
  INTO confirmed_count
  FROM public.registrations AS registration
  WHERE registration.category_id = NEW.category_id
    AND registration.status = 'CONFIRMED';

  WITH preview_players AS (
    SELECT
      (player_payload.value ->> 'id')::UUID AS player_id,
      CASE
        WHEN player_payload.value ? 'seed_number'
          AND jsonb_typeof(player_payload.value -> 'seed_number') <> 'null'
        THEN (player_payload.value ->> 'seed_number')::INTEGER
        ELSE NULL
      END AS seed_number,
      player_payload.value ->> 'full_name' AS full_name
    FROM jsonb_array_elements(NEW.groups_payload) AS group_payload(value)
    CROSS JOIN LATERAL jsonb_array_elements(group_payload.value -> 'players') AS player_payload(value)
  )
  SELECT
    count(*)::INTEGER,
    count(DISTINCT preview_players.player_id)::INTEGER,
    count(*) FILTER (
      WHERE registration.player_id IS NULL
         OR registration.status <> 'CONFIRMED'
         OR registration.seed_number IS DISTINCT FROM preview_players.seed_number
         OR (
           NEW.status = 'READY'
           AND private.competitor_name(NEW.category_id, preview_players.player_id) IS DISTINCT FROM preview_players.full_name
         )
    )::INTEGER
  INTO preview_count, preview_distinct_count, invalid_metadata_count
  FROM preview_players
  LEFT JOIN public.registrations AS registration
    ON registration.category_id = NEW.category_id
   AND registration.player_id = preview_players.player_id
  LEFT JOIN public.profiles AS profile
    ON profile.id = preview_players.player_id;

  IF preview_count <> confirmed_count
     OR preview_distinct_count <> preview_count
     OR invalid_metadata_count > 0 THEN
    RAISE EXCEPTION 'Preview player and seed metadata must match confirmed registrations.'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;


-- Either partner retains access to their own unpublished category metadata.
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
            AND (SELECT auth.uid()) IN (registration.player_id, registration.partner_id)
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
            AND (SELECT auth.uid()) IN (registration.player_id, registration.partner_id)
            AND registration.status IN ('CONFIRMED', 'WAITLISTED')
        )
      )
  );
END;
$$;


-- Apply the advancement repair to databases that already ran the earlier migration.
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


COMMIT;
