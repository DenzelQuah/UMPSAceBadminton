BEGIN;

-- EXCO can assign match duties without gaining tournament CRUD or role approval.
CREATE FUNCTION private.can_assign_match_officials() RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT auth.uid() IS NOT NULL AND private.approved_global_role(auth.uid()) IN ('SYSTEM_ADMIN','MT','EXCO');
$$;
REVOKE ALL ON FUNCTION private.can_assign_match_officials() FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION private.is_eligible_tournament_official(target UUID,event_uuid UUID) RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=target) AND (
    private.approved_global_role(target) IN ('SYSTEM_ADMIN','MT','EXCO','AJK')
    OR EXISTS(SELECT 1 FROM public.user_roles r WHERE r.user_id=target AND r.role_code='AJK'
      AND r.tournament_id=event_uuid AND r.match_id IS NULL AND r.source<>'MATCH'));
$$;

-- Both roster previews and writes use precisely the same conflict predicate.
-- This helper is private and is called only inside authenticated entry points.
CREATE FUNCTION private.match_official_unavailability(match_uuid UUID,target_uuid UUID) RETURNS TEXT
LANGUAGE SQL STABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT CASE
    WHEN target_uuid=ANY(array_remove(ARRAY[m.player_a_id,m.player_b_id,m.player_a_partner_id,m.player_b_partner_id],NULL))
      THEN 'Playing in this match'
    WHEN m.scheduled_time IS NULL THEN NULL
    WHEN EXISTS(SELECT 1 FROM public.matches other WHERE other.id<>m.id
      AND other.status NOT IN ('CANCELLED','POSTPONED') AND other.scheduled_time IS NOT NULL
      AND (other.umpire_id=target_uuid OR other.linesman_id=target_uuid)
      AND other.scheduled_time>m.scheduled_time-INTERVAL '40 minutes'
      AND other.scheduled_time<m.scheduled_time+INTERVAL '40 minutes')
      THEN 'Unavailable: assigned to an overlapping match'
    WHEN EXISTS(SELECT 1 FROM public.matches other WHERE other.id<>m.id
      AND other.status NOT IN ('CANCELLED','POSTPONED') AND other.scheduled_time IS NOT NULL
      AND (other.player_a_id=target_uuid OR other.player_b_id=target_uuid
        OR other.player_a_partner_id=target_uuid OR other.player_b_partner_id=target_uuid)
      AND other.scheduled_time>m.scheduled_time-INTERVAL '70 minutes'
      AND other.scheduled_time<m.scheduled_time+INTERVAL '70 minutes')
      THEN 'Unavailable: playing or within the player rest buffer'
    ELSE NULL END
  FROM public.matches m WHERE m.id=match_uuid;
$$;
REVOKE ALL ON FUNCTION private.match_official_unavailability(UUID,UUID) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.match_official_assignment_context(match_uuid UUID) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE fixture JSONB; event_uuid UUID; roster JSONB;
BEGIN
  IF NOT private.can_assign_match_officials() THEN
    RAISE EXCEPTION 'Approved MT, EXCO or administrator access is required.' USING ERRCODE='42501';
  END IF;
  SELECT c.tournament_id,jsonb_build_object(
    'id',m.id,'tournament_id',c.tournament_id,'tournament_title',t.title,'category_name',c.name,
    'status',m.status,'scheduled_time',m.scheduled_time,'court_number',m.court_number,
    'umpire_id',m.umpire_id,'linesman_id',m.linesman_id,'umpire_name',u.full_name,'linesman_name',l.full_name,
    'player_a_name',a.full_name||CASE WHEN ap.id IS NOT NULL THEN ' / '||ap.full_name ELSE '' END,
    'player_b_name',b.full_name||CASE WHEN bp.id IS NOT NULL THEN ' / '||bp.full_name ELSE '' END,
    'locked',m.status<>'SCHEDULED' OR t.status IN ('COMPLETED','ARCHIVED') OR c.status IN ('COMPLETED','ARCHIVED'))
  INTO event_uuid,fixture
  FROM public.matches m JOIN public.categories c ON c.id=m.category_id JOIN public.tournaments t ON t.id=c.tournament_id
    JOIN public.profiles a ON a.id=m.player_a_id JOIN public.profiles b ON b.id=m.player_b_id
    LEFT JOIN public.profiles ap ON ap.id=m.player_a_partner_id LEFT JOIN public.profiles bp ON bp.id=m.player_b_partner_id
    LEFT JOIN public.profiles u ON u.id=m.umpire_id LEFT JOIN public.profiles l ON l.id=m.linesman_id
  WHERE m.id=match_uuid AND (private.is_committee_member() OR (t.status<>'DRAFT' AND c.status IN
    ('DRAW_PUBLISHED','GROUP_STAGE_IN_PROGRESS','GROUP_STAGE_COMPLETED','KNOCKOUT_IN_PROGRESS','COMPLETED','ARCHIVED')));
  IF fixture IS NULL THEN RAISE EXCEPTION 'Match not found or its draw is not published.' USING ERRCODE='P0002'; END IF;

  WITH candidates AS MATERIALIZED (
    SELECT p.id,p.full_name,
      CASE WHEN private.approved_global_role(p.id)='PLAYER' THEN 'AJK' ELSE private.approved_global_role(p.id) END AS role_code,
      p.organizational_role_detail,private.match_official_unavailability(match_uuid,p.id) AS reason
    FROM public.profiles p WHERE private.is_eligible_tournament_official(p.id,event_uuid)
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'full_name',full_name,'organizational_role',role_code,
    'organizational_role_detail',organizational_role_detail,'available',reason IS NULL,'unavailable_reason',reason)
    ORDER BY reason IS NOT NULL,lower(full_name),id),'[]'::JSONB) INTO roster FROM candidates;
  RETURN jsonb_build_object('match',fixture,'officials',roster);
END;
$$;
REVOKE ALL ON FUNCTION private.match_official_assignment_context(UUID) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.match_official_assignment_context(UUID) TO authenticated;

CREATE FUNCTION public.get_match_official_availability(match_uuid UUID) RETURNS JSONB
LANGUAGE SQL STABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT private.match_official_assignment_context(match_uuid);
$$;
REVOKE ALL ON FUNCTION public.get_match_official_availability(UUID) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_match_official_availability(UUID) TO authenticated;

CREATE FUNCTION private.assign_match_officials(match_uuid UUID,umpire_uuid UUID,linesman_uuid UUID)
RETURNS TABLE(id UUID,umpire_id UUID,linesman_id UUID)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE fixture public.matches%ROWTYPE; event_uuid UUID; event_status TEXT; category_status TEXT; target UUID; reason TEXT;
BEGIN
  IF NOT private.can_assign_match_officials() THEN
    RAISE EXCEPTION 'Approved MT, EXCO or administrator access is required.' USING ERRCODE='42501';
  END IF;
  SELECT m.* INTO fixture FROM public.matches m WHERE m.id=match_uuid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Match not found.' USING ERRCODE='P0002'; END IF;
  -- Shared with schedule_match and the doubles guard, including other tournaments.
  PERFORM pg_advisory_xact_lock(hashtextextended('umpsace:match-scheduling',0));
  SELECT c.tournament_id,t.status::TEXT,c.status::TEXT INTO event_uuid,event_status,category_status
    FROM public.categories c JOIN public.tournaments t ON t.id=c.tournament_id WHERE c.id=fixture.category_id;
  IF NOT private.is_committee_member() AND (event_status='DRAFT' OR category_status NOT IN
    ('DRAW_PUBLISHED','GROUP_STAGE_IN_PROGRESS','GROUP_STAGE_COMPLETED','KNOCKOUT_IN_PROGRESS','COMPLETED','ARCHIVED')) THEN
    RAISE EXCEPTION 'The match draw is not published.' USING ERRCODE='P0002';
  END IF;
  IF fixture.status<>'SCHEDULED' OR event_status IN ('COMPLETED','ARCHIVED') OR category_status IN ('COMPLETED','ARCHIVED') THEN
    RAISE EXCEPTION 'Officials can only be changed before a match begins in an active tournament.' USING ERRCODE='P0001';
  END IF;
  IF umpire_uuid IS NOT NULL AND umpire_uuid=linesman_uuid THEN
    RAISE EXCEPTION 'Choose different people for umpire and linesman.' USING ERRCODE='22023';
  END IF;
  FOREACH target IN ARRAY array_remove(ARRAY[umpire_uuid,linesman_uuid],NULL) LOOP
    IF NOT private.is_eligible_tournament_official(target,event_uuid) THEN
      RAISE EXCEPTION 'The selected official is not approved for this tournament.' USING ERRCODE='22023';
    END IF;
    reason:=private.match_official_unavailability(match_uuid,target);
    IF reason='Playing in this match' THEN RAISE EXCEPTION '%',reason USING ERRCODE='22023'; END IF;
    IF reason IS NOT NULL THEN RAISE EXCEPTION '%',reason USING ERRCODE='P0001'; END IF;
  END LOOP;
  UPDATE public.matches m SET umpire_id=umpire_uuid,linesman_id=linesman_uuid WHERE m.id=match_uuid;
  -- Existing triggers synchronize match duty roles and the live score snapshot.
  INSERT INTO public.audit_logs(actor_id,action,entity_type,entity_id,original_data,new_data)
    VALUES(auth.uid(),'MATCH_OFFICIALS_ASSIGNED','match',match_uuid,
      jsonb_build_object('umpire_id',fixture.umpire_id,'linesman_id',fixture.linesman_id),
      jsonb_build_object('umpire_id',umpire_uuid,'linesman_id',linesman_uuid));
  RETURN QUERY SELECT match_uuid,umpire_uuid,linesman_uuid;
END;
$$;
REVOKE ALL ON FUNCTION private.assign_match_officials(UUID,UUID,UUID) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.assign_match_officials(UUID,UUID,UUID) TO authenticated;

-- Preserve the established RPC contract; no broad matches UPDATE grant for EXCO.
CREATE OR REPLACE FUNCTION public.assign_match_officials(match_uuid UUID,umpire_uuid UUID,linesman_uuid UUID)
RETURNS TABLE(id UUID,umpire_id UUID,linesman_id UUID)
LANGUAGE SQL SECURITY INVOKER SET search_path='' AS $$
  SELECT * FROM private.assign_match_officials(match_uuid,umpire_uuid,linesman_uuid);
$$;
REVOKE ALL ON FUNCTION public.assign_match_officials(UUID,UUID,UUID) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.assign_match_officials(UUID,UUID,UUID) TO authenticated;

COMMIT;
