BEGIN;

CREATE TABLE public.live_match_scores (
  match_id UUID PRIMARY KEY REFERENCES public.matches(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  group_id UUID REFERENCES public.groups(id) ON DELETE SET NULL,
  status TEXT NOT NULL,
  winner_id UUID,
  games JSONB NOT NULL DEFAULT '[]',
  version BIGINT NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX live_scores_category ON public.live_match_scores(category_id);
ALTER TABLE public.live_match_scores ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.live_match_scores FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.live_match_scores TO authenticated;
CREATE POLICY visible_match_scores ON public.live_match_scores FOR SELECT TO authenticated
  USING(EXISTS(SELECT 1 FROM public.matches m WHERE m.id=live_match_scores.match_id));

CREATE FUNCTION private.sync_live_match_score(match_uuid UUID) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  INSERT INTO public.live_match_scores(match_id,category_id,group_id,status,winner_id,games)
    SELECT m.id,m.category_id,m.group_id,m.status::TEXT,m.winner_id,
      coalesce((SELECT jsonb_agg(jsonb_build_object('gameNumber',g.game_number,'playerAScore',g.player_a_score,'playerBScore',g.player_b_score) ORDER BY g.game_number) FROM public.match_games g WHERE g.match_id=m.id),'[]'::JSONB)
    FROM public.matches m WHERE m.id=match_uuid
    ON CONFLICT(match_id) DO UPDATE SET category_id=EXCLUDED.category_id,group_id=EXCLUDED.group_id,
      status=EXCLUDED.status,winner_id=EXCLUDED.winner_id,games=EXCLUDED.games,version=public.live_match_scores.version+1,updated_at=now();
END;
$$;
REVOKE ALL ON FUNCTION private.sync_live_match_score(UUID) FROM PUBLIC,anon,authenticated,service_role;

-- Supabase provides realtime.send(). Isolated PostgreSQL test environments may
-- omit Realtime; they can install a transactional stub to verify event payloads.
CREATE FUNCTION private.send_score_broadcast(payload JSONB,event_name TEXT,category_uuid UUID) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF to_regprocedure('realtime.send(jsonb,text,text,boolean)') IS NOT NULL THEN
    PERFORM realtime.send(payload,event_name,'scores:category:'||category_uuid::TEXT,TRUE);
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION private.send_score_broadcast(JSONB,TEXT,UUID) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.broadcast_live_score() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM private.send_score_broadcast(to_jsonb(NEW),'score_changed',NEW.category_id);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.broadcast_live_score() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.refresh_live_score_from_game() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM private.sync_live_match_score(CASE WHEN TG_OP='DELETE' THEN OLD.match_id ELSE NEW.match_id END);
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION private.refresh_live_score_from_game() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.refresh_live_score_from_match() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM private.sync_live_match_score(NEW.id);
  PERFORM private.send_score_broadcast(jsonb_build_object('category_id',NEW.category_id),'draw_changed',NEW.category_id);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.refresh_live_score_from_match() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER sync_live_game AFTER INSERT OR UPDATE OR DELETE ON public.match_games FOR EACH ROW EXECUTE FUNCTION private.refresh_live_score_from_game();
CREATE TRIGGER sync_live_fixture AFTER INSERT OR UPDATE OF status,winner_id,court_number,scheduled_time,umpire_id,linesman_id ON public.matches FOR EACH ROW EXECUTE FUNCTION private.refresh_live_score_from_match();

-- Backfill before installing the broadcaster: no event storm for old fixtures.
DO $$ DECLARE row_record RECORD; BEGIN FOR row_record IN SELECT id FROM public.matches LOOP PERFORM private.sync_live_match_score(row_record.id); END LOOP; END $$;
CREATE TRIGGER broadcast_committed_score AFTER INSERT OR UPDATE ON public.live_match_scores FOR EACH ROW EXECUTE FUNCTION private.broadcast_live_score();

CREATE FUNCTION private.can_watch_score_topic(topic_value TEXT) RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE category_uuid UUID;
BEGIN
  IF auth.uid() IS NULL OR topic_value !~ '^scores:category:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN RETURN FALSE; END IF;
  category_uuid:=split_part(topic_value,':',3)::UUID;
  RETURN EXISTS(SELECT 1 FROM public.categories c WHERE c.id=category_uuid AND (private.is_committee_member() OR c.status IN('DRAW_PUBLISHED','GROUP_STAGE_IN_PROGRESS','GROUP_STAGE_COMPLETED','KNOCKOUT_IN_PROGRESS','COMPLETED')));
END;
$$;
REVOKE ALL ON FUNCTION private.can_watch_score_topic(TEXT) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.can_watch_score_topic(TEXT) TO authenticated;
DO $$ BEGIN
  IF to_regclass('realtime.messages') IS NOT NULL THEN
    EXECUTE 'CREATE POLICY tournament_score_receivers ON realtime.messages FOR SELECT TO authenticated USING(extension=''broadcast'' AND private.can_watch_score_topic((SELECT realtime.topic())))';
  END IF;
END $$;
-- Deliberately no INSERT policy: clients cannot impersonate database broadcasts.

CREATE TABLE private.point_operations (
  operation_id UUID PRIMARY KEY,
  match_id UUID NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  actor_id UUID NOT NULL,
  command JSONB NOT NULL,
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE private.point_operations ENABLE ROW LEVEL SECURITY;
CREATE INDEX point_operations_match ON private.point_operations(match_id);
REVOKE ALL ON private.point_operations FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.adjust_match_point(match_uuid UUID,game_number_value INTEGER,side_value TEXT,delta_value INTEGER,expected_version BIGINT,operation_uuid UUID)
RETURNS public.live_match_scores LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE m public.matches%ROWTYPE; game public.match_games%ROWTYPE; format_value public.scoring_format;
  snapshot public.live_match_scores%ROWTYPE; saved private.point_operations%ROWTYPE; command_value JSONB;
  a INTEGER:=0; b INTEGER:=0;
BEGIN
  IF auth.uid() IS NULL OR NOT private.is_authorized_match_operator(match_uuid) THEN RAISE EXCEPTION 'Only the assigned umpire or MT can score this match.' USING ERRCODE='42501'; END IF;
  IF game_number_value IS NULL OR game_number_value NOT BETWEEN 1 AND 3 OR side_value IS NULL OR side_value NOT IN('a','b') OR delta_value IS NULL OR delta_value NOT IN(-1,1) OR expected_version IS NULL OR operation_uuid IS NULL THEN RAISE EXCEPTION 'Invalid point operation.' USING ERRCODE='22023'; END IF;
  SELECT * INTO m FROM public.matches WHERE id=match_uuid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Match not found.' USING ERRCODE='P0002'; END IF;
  IF NOT private.is_authorized_match_operator(match_uuid) THEN RAISE EXCEPTION 'Assignment changed.' USING ERRCODE='42501'; END IF;
  command_value:=jsonb_build_object('game',game_number_value,'side',side_value,'delta',delta_value,'expected_version',expected_version);
  SELECT * INTO saved FROM private.point_operations WHERE operation_id=operation_uuid;
  IF FOUND THEN
    IF saved.actor_id<>auth.uid() OR saved.match_id<>match_uuid OR saved.command<>command_value THEN RAISE EXCEPTION 'Operation identity cannot be reused.' USING ERRCODE='22023'; END IF;
    SELECT * INTO snapshot FROM public.live_match_scores WHERE match_id=match_uuid;
    RETURN snapshot;
  END IF;
  IF m.status<>'IN_PROGRESS' THEN RAISE EXCEPTION 'Match is not in progress.' USING ERRCODE='P0001'; END IF;
  SELECT * INTO snapshot FROM public.live_match_scores WHERE match_id=match_uuid;
  IF snapshot.version IS DISTINCT FROM expected_version THEN RAISE EXCEPTION 'The score changed. Reload the current score.' USING ERRCODE='40001'; END IF;
  SELECT c.format INTO format_value FROM public.categories c WHERE c.id=m.category_id;
  SELECT * INTO game FROM public.match_games WHERE match_id=match_uuid AND game_number=game_number_value;
  a:=coalesce(game.player_a_score,0); b:=coalesce(game.player_b_score,0);
  IF game_number_value>1 AND NOT EXISTS(SELECT 1 FROM public.match_games g WHERE g.match_id=match_uuid AND g.game_number=game_number_value-1 AND private.is_game_complete(format_value,g.player_a_score,g.player_b_score)) THEN
    RAISE EXCEPTION 'Finish the preceding game first.' USING ERRCODE='22023'; END IF;
  IF EXISTS(SELECT 1 FROM public.match_games g WHERE g.match_id=match_uuid AND g.game_number>game_number_value AND (g.player_a_score>0 OR g.player_b_score>0)) THEN RAISE EXCEPTION 'A later game has started.' USING ERRCODE='P0001'; END IF;
  IF delta_value=1 AND private.is_game_complete(format_value,a,b) THEN RAISE EXCEPTION 'This game is complete.' USING ERRCODE='P0001'; END IF;
  IF side_value='a' THEN a:=a+delta_value; ELSE b:=b+delta_value; END IF;
  IF NOT private.is_valid_game_score(format_value,game_number_value,a,b) THEN RAISE EXCEPTION 'Invalid score for this game.' USING ERRCODE='22023'; END IF;
  INSERT INTO public.match_games(match_id,game_number,player_a_score,player_b_score) VALUES(match_uuid,game_number_value,a,b)
    ON CONFLICT(match_id,game_number) DO UPDATE SET player_a_score=EXCLUDED.player_a_score,player_b_score=EXCLUDED.player_b_score;
  SELECT * INTO snapshot FROM public.live_match_scores WHERE match_id=match_uuid;
  INSERT INTO private.point_operations(operation_id,match_id,actor_id,command,result) VALUES(operation_uuid,match_uuid,auth.uid(),command_value,to_jsonb(snapshot));
  INSERT INTO public.audit_logs(actor_id,action,entity_type,entity_id,original_data,new_data)
    VALUES(auth.uid(),'MATCH_POINT_ADJUSTED','match',match_uuid,jsonb_build_object('version',expected_version),jsonb_build_object('game',game_number_value,'side',side_value,'delta',delta_value,'version',snapshot.version));
  RETURN snapshot;
END;
$$;
REVOKE ALL ON FUNCTION public.adjust_match_point(UUID,INTEGER,TEXT,INTEGER,BIGINT,UUID) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.adjust_match_point(UUID,INTEGER,TEXT,INTEGER,BIGINT,UUID) TO authenticated;

COMMIT;
