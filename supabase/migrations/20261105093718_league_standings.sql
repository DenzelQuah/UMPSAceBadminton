BEGIN;

ALTER TABLE public.global_rankings
  ADD COLUMN games_won INTEGER NOT NULL DEFAULT 0 CHECK (games_won >= 0),
  ADD COLUMN points_won INTEGER NOT NULL DEFAULT 0 CHECK (points_won >= 0),
  ADD COLUMN points_lost INTEGER NOT NULL DEFAULT 0 CHECK (points_lost >= 0),
  ADD COLUMN participations INTEGER NOT NULL DEFAULT 0 CHECK (participations >= 0);

-- One canonical contribution per athlete per finalized fixture. The caller must
-- choose a tournament and/or enforce publication; this helper is not a public API.
CREATE FUNCTION private.ranking_match_lines(tournament_uuid UUID DEFAULT NULL)
RETURNS TABLE (
  match_id UUID, tournament_id UUID, profile_id UUID, opponent_ids UUID[],
  is_win BOOLEAN, games_won INTEGER, points_won INTEGER, points_lost INTEGER,
  participation INTEGER, ranking_points INTEGER, result_at TIMESTAMPTZ
)
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH sides AS (
    SELECT m.id, c.tournament_id, athlete.id AS athlete_id,
      private.competitor_members(m.category_id, side.opponent) AS opponents,
      m.winner_id = side.representative AS won,
      m.status,
      CASE WHEN c.format = 'STANDARD_3X21' THEN 2 ELSE 1 END AS awarded_games,
      CASE WHEN c.format = 'STANDARD_3X21' THEN 42 ELSE 30 END AS awarded_points,
      coalesce(m.scheduled_time, (
        SELECT min(a.created_at) FROM public.audit_logs a
        WHERE a.entity_type = 'match' AND a.entity_id = m.id
          AND a.action = 'MATCH_RESULT_SUBMITTED'
      ), m.created_at) AS played_at,
      scores.game_wins, scores.points_for, scores.points_against
    FROM public.matches m
    JOIN public.categories c ON c.id = m.category_id
    CROSS JOIN LATERAL (VALUES (m.player_a_id, m.player_b_id), (m.player_b_id, m.player_a_id)) side(representative, opponent)
    CROSS JOIN LATERAL unnest(private.competitor_members(m.category_id, side.representative)) athlete(id)
    CROSS JOIN LATERAL (
      SELECT count(*) FILTER (WHERE private.is_game_complete(c.format, g.player_a_score, g.player_b_score)
          AND CASE WHEN side.representative = m.player_a_id THEN g.player_a_score > g.player_b_score ELSE g.player_b_score > g.player_a_score END)::INTEGER AS game_wins,
        coalesce(sum(CASE WHEN side.representative = m.player_a_id THEN g.player_a_score ELSE g.player_b_score END), 0)::INTEGER AS points_for,
        coalesce(sum(CASE WHEN side.representative = m.player_a_id THEN g.player_b_score ELSE g.player_a_score END), 0)::INTEGER AS points_against
      FROM public.match_games g WHERE g.match_id = m.id
    ) scores
    WHERE m.status IN ('COMPLETED', 'WALKOVER', 'RETIRED') AND m.winner_id IS NOT NULL
      AND (tournament_uuid IS NULL OR c.tournament_id = tournament_uuid)
  ), contributions AS (
    SELECT s.*,
      CASE WHEN s.status = 'WALKOVER' THEN CASE WHEN s.won THEN s.awarded_games ELSE 0 END ELSE s.game_wins END AS credited_games,
      CASE WHEN s.status = 'WALKOVER' THEN CASE WHEN s.won THEN s.awarded_points ELSE 0 END ELSE s.points_for END AS credited_for,
      CASE WHEN s.status = 'WALKOVER' THEN CASE WHEN s.won THEN 0 ELSE s.awarded_points END ELSE s.points_against END AS credited_against,
      CASE WHEN s.status = 'WALKOVER' AND NOT s.won THEN 0 ELSE 1 END AS attendance
    FROM sides s
  )
  SELECT c.id, c.tournament_id, c.athlete_id, c.opponents, c.won,
    c.credited_games, c.credited_for, c.credited_against, c.attendance,
    CASE WHEN c.won THEN 3 ELSE 0 END + c.credited_games + c.attendance,
    c.played_at
  FROM contributions c;
$$;
REVOKE ALL ON FUNCTION private.ranking_match_lines(UUID) FROM PUBLIC, anon, authenticated, service_role;

-- Extend the existing atomic, idempotent completion operation. No live scores
-- can contribute; complete_tournament sets COMPLETED inside this transaction.
CREATE OR REPLACE FUNCTION private.process_tournament_rankings(tournament_uuid UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE tournament_record public.tournaments%ROWTYPE;
BEGIN
  SELECT * INTO tournament_record FROM public.tournaments WHERE id = tournament_uuid FOR UPDATE;
  IF NOT FOUND OR tournament_record.status <> 'COMPLETED' THEN
    RAISE EXCEPTION 'Only a completed tournament can publish rankings.' USING ERRCODE = 'P0001';
  END IF;
  IF tournament_record.rankings_processed_at IS NOT NULL THEN RETURN; END IF;

  INSERT INTO public.global_rankings AS current (
    profile_id, ranking_points, net_points, matches_won, matches_played,
    games_won, points_won, points_lost, participations
  )
  SELECT l.profile_id, sum(l.ranking_points)::INTEGER, sum(l.points_won - l.points_lost)::INTEGER,
    count(*) FILTER (WHERE l.is_win)::INTEGER, count(*)::INTEGER,
    sum(l.games_won)::INTEGER, sum(l.points_won)::INTEGER, sum(l.points_lost)::INTEGER, sum(l.participation)::INTEGER
  FROM private.ranking_match_lines(tournament_uuid) l GROUP BY l.profile_id
  ON CONFLICT (profile_id) DO UPDATE SET
    ranking_points = current.ranking_points + EXCLUDED.ranking_points,
    net_points = current.net_points + EXCLUDED.net_points,
    matches_won = current.matches_won + EXCLUDED.matches_won,
    matches_played = current.matches_played + EXCLUDED.matches_played,
    games_won = current.games_won + EXCLUDED.games_won,
    points_won = current.points_won + EXCLUDED.points_won,
    points_lost = current.points_lost + EXCLUDED.points_lost,
    participations = current.participations + EXCLUDED.participations,
    updated_at = now();

  UPDATE public.tournaments SET rankings_processed_at = now() WHERE id = tournament_uuid;
END;
$$;
REVOKE ALL ON FUNCTION private.process_tournament_rankings(UUID) FROM PUBLIC, anon, authenticated, service_role;

-- Reconcile already-published accumulators from protected records. Scores,
-- registrations, tournament history and publication timestamps are preserved.
INSERT INTO public.global_rankings AS current (
  profile_id, ranking_points, net_points, matches_won, matches_played,
  games_won, points_won, points_lost, participations
)
SELECT l.profile_id, sum(l.ranking_points)::INTEGER, sum(l.points_won-l.points_lost)::INTEGER,
  count(*) FILTER (WHERE l.is_win)::INTEGER, count(*)::INTEGER,
  sum(l.games_won)::INTEGER, sum(l.points_won)::INTEGER, sum(l.points_lost)::INTEGER, sum(l.participation)::INTEGER
FROM private.ranking_match_lines(NULL) l
JOIN public.tournaments t ON t.id = l.tournament_id
WHERE t.rankings_processed_at IS NOT NULL AND t.status IN ('COMPLETED', 'ARCHIVED')
GROUP BY l.profile_id
ON CONFLICT (profile_id) DO UPDATE SET
  ranking_points = EXCLUDED.ranking_points, net_points = EXCLUDED.net_points,
  matches_won = EXCLUDED.matches_won, matches_played = EXCLUDED.matches_played,
  games_won = EXCLUDED.games_won, points_won = EXCLUDED.points_won,
  points_lost = EXCLUDED.points_lost, participations = EXCLUDED.participations;

CREATE FUNCTION public.get_league_standings()
RETURNS TABLE (
  rank_position BIGINT, profile_id UUID, full_name VARCHAR, ranking_points INTEGER,
  net_points INTEGER, matches_won INTEGER, matches_played INTEGER, matches_lost INTEGER,
  games_won INTEGER, points_won INTEGER, points_lost INTEGER, participations INTEGER,
  win_percentage NUMERIC, recent_form TEXT[]
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication is required.' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  WITH entrants AS (
    SELECT r.player_id AS id FROM public.registrations r
    UNION SELECT r.partner_id FROM public.registrations r WHERE r.partner_id IS NOT NULL
    UNION SELECT i.inviter_id FROM public.doubles_invitations i WHERE i.status = 'ACCEPTED'
    UNION SELECT i.partner_id FROM public.doubles_invitations i WHERE i.status = 'ACCEPTED'
    UNION SELECT g.profile_id FROM public.global_rankings g
  ), totals AS (
    SELECT p.id, p.full_name, coalesce(g.ranking_points, 0) AS rp, coalesce(g.net_points, 0) AS np,
      coalesce(g.matches_won, 0) AS wins, coalesce(g.matches_played, 0) AS played,
      coalesce(g.games_won, 0) AS games, coalesce(g.points_won, 0) AS pf, coalesce(g.points_lost, 0) AS pa,
      coalesce(g.participations, 0) AS attendance,
      CASE WHEN coalesce(g.matches_played, 0) = 0 THEN 0::NUMERIC
        ELSE round(g.matches_won::NUMERIC * 100 / g.matches_played, 2) END AS win_pct
    FROM entrants e JOIN public.profiles p ON p.id = e.id LEFT JOIN public.global_rankings g ON g.profile_id = e.id
  ), ties AS (
    SELECT s.*, count(*) OVER tie_group AS tied_count, array_agg(s.id) OVER tie_group AS tied_ids
    FROM totals s WINDOW tie_group AS (PARTITION BY s.rp, s.np, s.wins, s.win_pct)
  ), published AS MATERIALIZED (
    SELECT l.* FROM private.ranking_match_lines(NULL) l JOIN public.tournaments t ON t.id = l.tournament_id
    WHERE t.rankings_processed_at IS NOT NULL AND t.status IN ('COMPLETED', 'ARCHIVED')
  ), resolved AS (
    SELECT s.*, CASE WHEN s.tied_count = 2 THEN coalesce((
      SELECT CASE WHEN l.is_win THEN 1 ELSE 0 END FROM published l
      WHERE l.profile_id = s.id AND l.opponent_ids && array_remove(s.tied_ids, s.id)
      ORDER BY l.result_at DESC, l.match_id DESC LIMIT 1
    ), 0) ELSE 0 END AS head_to_head,
    ARRAY(SELECT recent.outcome FROM (
      SELECT CASE WHEN l.is_win THEN 'W' ELSE 'L' END AS outcome, l.result_at, l.match_id
      FROM published l WHERE l.profile_id = s.id ORDER BY l.result_at DESC, l.match_id DESC LIMIT 5
    ) recent ORDER BY recent.result_at, recent.match_id) AS form
    FROM ties s
  )
  SELECT rank() OVER (ORDER BY s.rp DESC, s.np DESC, s.wins DESC, s.win_pct DESC, s.head_to_head DESC),
    s.id, s.full_name, s.rp, s.np, s.wins, s.played, s.played-s.wins,
    s.games, s.pf, s.pa, s.attendance, s.win_pct, s.form
  FROM resolved s
  ORDER BY s.rp DESC, s.np DESC, s.wins DESC, s.win_pct DESC, s.head_to_head DESC, lower(s.full_name), s.id;
END;
$$;
REVOKE ALL ON FUNCTION public.get_league_standings() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_league_standings() TO authenticated, service_role;

-- Preserve the original RPC contract for older callers while sharing the exact
-- ranking order (including shared positions and the full tiebreak cascade).
CREATE OR REPLACE FUNCTION public.get_global_rankings()
RETURNS TABLE(rank_position BIGINT, profile_id UUID, full_name VARCHAR, ranking_points INTEGER,
  net_points INTEGER, matches_won INTEGER, matches_played INTEGER)
LANGUAGE SQL STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT s.rank_position, s.profile_id, s.full_name, s.ranking_points, s.net_points, s.matches_won, s.matches_played
  FROM public.get_league_standings() s;
$$;

COMMIT;
