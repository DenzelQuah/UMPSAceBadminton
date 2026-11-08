BEGIN;

-- Organization appointments remain administrator-approved. Tournament AJK
-- appointments are separate grants reviewed by MT or a system administrator.
CREATE TABLE public.roles (
  code TEXT PRIMARY KEY CHECK (code IN ('PLAYER','AJK','EXCO','UMPIRE','LINESMAN','MT','SYSTEM_ADMIN')),
  label TEXT NOT NULL
);
INSERT INTO public.roles VALUES ('PLAYER','Player'),('AJK','Committee'),('EXCO','EXCO'),
  ('UMPIRE','Umpire'),('LINESMAN','Linesman'),('MT','Management Team'),('SYSTEM_ADMIN','System Admin');
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.roles FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.roles TO authenticated;
CREATE POLICY signed_in_role_catalog ON public.roles FOR SELECT TO authenticated USING (true);

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role_code TEXT NOT NULL REFERENCES public.roles(code),
  tournament_id UUID REFERENCES public.tournaments(id) ON DELETE CASCADE,
  match_id UUID REFERENCES public.matches(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('PROFILE','APPLICATION','MATCH','ADVISOR')),
  granted_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((source='PROFILE' AND tournament_id IS NULL AND match_id IS NULL AND role_code NOT IN ('UMPIRE','LINESMAN'))
    OR (source='APPLICATION' AND tournament_id IS NOT NULL AND match_id IS NULL AND role_code='AJK')
    OR (source='MATCH' AND tournament_id IS NOT NULL AND match_id IS NOT NULL AND role_code IN ('UMPIRE','LINESMAN'))
    OR (source='ADVISOR' AND tournament_id IS NULL AND match_id IS NULL AND role_code='SYSTEM_ADMIN'))
);
CREATE UNIQUE INDEX unique_global_user_role ON public.user_roles(user_id,role_code,source) WHERE tournament_id IS NULL;
CREATE UNIQUE INDEX unique_tournament_user_role ON public.user_roles(user_id,tournament_id,role_code) WHERE match_id IS NULL AND tournament_id IS NOT NULL;
CREATE UNIQUE INDEX unique_match_user_role ON public.user_roles(match_id,role_code) WHERE match_id IS NOT NULL;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_roles FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.user_roles TO authenticated;

-- Set only to the exact advisor email supplied by the project owner. NULL is
-- deliberately inactive; never infer a privileged identity from a domain/name.
CREATE FUNCTION private.backup_manager_email() RETURNS TEXT LANGUAGE SQL IMMUTABLE SET search_path='' AS $$ SELECT NULL::TEXT; $$;
REVOKE ALL ON FUNCTION private.backup_manager_email() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.is_verified_backup_manager(target UUID) RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT EXISTS(SELECT 1 FROM auth.users u WHERE u.id=target
    AND lower(u.email)=lower(private.backup_manager_email())
    AND to_jsonb(u)->>'email_confirmed_at' IS NOT NULL);
$$;
REVOKE ALL ON FUNCTION private.is_verified_backup_manager(UUID) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.sync_profile_user_roles() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  DELETE FROM public.user_roles WHERE user_id=NEW.id AND source IN ('PROFILE','ADVISOR');
  INSERT INTO public.user_roles(user_id,role_code,source) VALUES(NEW.id,'PLAYER','PROFILE');
  IF NEW.is_admin THEN INSERT INTO public.user_roles(user_id,role_code,source) VALUES(NEW.id,'SYSTEM_ADMIN','PROFILE'); END IF;
  IF NEW.organizational_role <> 'PLAYER' THEN INSERT INTO public.user_roles(user_id,role_code,source) VALUES(NEW.id,NEW.organizational_role,'PROFILE'); END IF;
  IF private.is_verified_backup_manager(NEW.id) THEN INSERT INTO public.user_roles(user_id,role_code,source) VALUES(NEW.id,'SYSTEM_ADMIN','ADVISOR'); END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.sync_profile_user_roles() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER sync_profile_roles AFTER INSERT OR UPDATE OF is_admin,organizational_role ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION private.sync_profile_user_roles();
-- Backfill without changing any existing approved profile privileges.
UPDATE public.profiles SET organizational_role=organizational_role;

CREATE FUNCTION private.sync_advisor_user_role() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  DELETE FROM public.user_roles WHERE user_id=NEW.id AND source='ADVISOR';
  IF private.is_verified_backup_manager(NEW.id) AND EXISTS(SELECT 1 FROM public.profiles WHERE id=NEW.id) THEN
    INSERT INTO public.user_roles(user_id,role_code,source) VALUES(NEW.id,'SYSTEM_ADMIN','ADVISOR');
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.sync_advisor_user_role() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER sync_advisor_role AFTER INSERT OR UPDATE ON auth.users FOR EACH ROW EXECUTE FUNCTION private.sync_advisor_user_role();

CREATE OR REPLACE FUNCTION private.is_platform_admin() RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT EXISTS(SELECT 1 FROM public.user_roles r WHERE r.user_id=auth.uid() AND r.role_code='SYSTEM_ADMIN'
    AND (r.source='PROFILE' OR (r.source='ADVISOR' AND private.is_verified_backup_manager(r.user_id))));
$$;
CREATE OR REPLACE FUNCTION private.is_committee_member() RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT private.is_platform_admin() OR EXISTS(SELECT 1 FROM public.user_roles r
    WHERE r.user_id=auth.uid() AND r.role_code='MT' AND r.tournament_id IS NULL);
$$;
CREATE POLICY own_or_management_roles ON public.user_roles FOR SELECT TO authenticated
  USING(user_id=(SELECT auth.uid()) OR private.is_committee_member());

CREATE TABLE public.tournament_ajk_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  tournament_id UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','APPROVED','REJECTED')),
  reviewed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX one_active_ajk_application ON public.tournament_ajk_applications(user_id,tournament_id) WHERE status IN ('PENDING','APPROVED');
CREATE INDEX pending_ajk_applications ON public.tournament_ajk_applications(created_at) WHERE status='PENDING';
ALTER TABLE public.tournament_ajk_applications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tournament_ajk_applications FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.tournament_ajk_applications TO authenticated;
CREATE POLICY applicant_or_management ON public.tournament_ajk_applications FOR SELECT TO authenticated
  USING(user_id=(SELECT auth.uid()) OR private.is_committee_member());

CREATE FUNCTION public.apply_for_tournament_ajk(tournament_uuid UUID)
RETURNS public.tournament_ajk_applications LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result public.tournament_ajk_applications%ROWTYPE; event_status TEXT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in first.' USING ERRCODE='42501'; END IF;
  SELECT status INTO event_status FROM public.tournaments WHERE id=tournament_uuid FOR SHARE;
  IF NOT FOUND OR event_status='DRAFT' THEN RAISE EXCEPTION 'Tournament is unavailable.' USING ERRCODE='P0002'; END IF;
  IF event_status IN ('COMPLETED','ARCHIVED','CANCELLED') THEN RAISE EXCEPTION 'Applications are closed for this tournament.' USING ERRCODE='22023'; END IF;
  IF EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=auth.uid() AND role_code='AJK' AND (tournament_id IS NULL OR tournament_id=tournament_uuid)) THEN
    RAISE EXCEPTION 'You already have AJK access for this tournament.' USING ERRCODE='22023'; END IF;
  INSERT INTO public.tournament_ajk_applications(user_id,tournament_id) VALUES(auth.uid(),tournament_uuid)
    ON CONFLICT(user_id,tournament_id) WHERE status IN ('PENDING','APPROVED') DO UPDATE SET user_id=EXCLUDED.user_id
    RETURNING * INTO result;
  RETURN result;
END;
$$;

CREATE FUNCTION public.review_tournament_ajk(application_uuid UUID,approve BOOLEAN)
RETURNS public.tournament_ajk_applications LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result public.tournament_ajk_applications%ROWTYPE; old_record JSONB; event_status TEXT;
BEGIN
  IF NOT private.is_committee_member() THEN RAISE EXCEPTION 'MT or System Admin access is required.' USING ERRCODE='42501'; END IF;
  IF approve IS NULL THEN RAISE EXCEPTION 'Choose approve or reject.' USING ERRCODE='22023'; END IF;
  SELECT * INTO result FROM public.tournament_ajk_applications WHERE id=application_uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Application not found.' USING ERRCODE='P0002'; END IF;
  IF result.user_id=auth.uid() THEN RAISE EXCEPTION 'You cannot review your own application.' USING ERRCODE='42501'; END IF;
  SELECT status INTO event_status FROM public.tournaments WHERE id=result.tournament_id FOR SHARE;
  SELECT * INTO result FROM public.tournament_ajk_applications WHERE id=application_uuid FOR UPDATE;
  IF result.status<>'PENDING' THEN RAISE EXCEPTION 'This application has already been reviewed.' USING ERRCODE='P0001'; END IF;
  IF approve AND event_status IN ('COMPLETED','ARCHIVED','CANCELLED') THEN RAISE EXCEPTION 'The tournament has ended.' USING ERRCODE='22023'; END IF;
  old_record:=to_jsonb(result);
  UPDATE public.tournament_ajk_applications SET status=CASE WHEN approve THEN 'APPROVED' ELSE 'REJECTED' END,
    reviewed_by=auth.uid(),reviewed_at=now() WHERE id=application_uuid RETURNING * INTO result;
  IF approve THEN
    INSERT INTO public.user_roles(user_id,role_code,tournament_id,source,granted_by)
      VALUES(result.user_id,'AJK',result.tournament_id,'APPLICATION',auth.uid()) ON CONFLICT DO NOTHING;
  END IF;
  INSERT INTO public.audit_logs(actor_id,action,entity_type,entity_id,original_data,new_data)
    VALUES(auth.uid(),CASE WHEN approve THEN 'TOURNAMENT_AJK_APPROVED' ELSE 'TOURNAMENT_AJK_REJECTED' END,
      'tournament_ajk_application',application_uuid,old_record,to_jsonb(result));
  RETURN result;
END;
$$;

CREATE FUNCTION public.list_pending_tournament_ajk()
RETURNS TABLE(id UUID,user_id UUID,tournament_id UUID,full_name VARCHAR,email VARCHAR,tournament_title VARCHAR,created_at TIMESTAMPTZ)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NOT private.is_committee_member() THEN RAISE EXCEPTION 'MT or System Admin access is required.' USING ERRCODE='42501'; END IF;
  RETURN QUERY SELECT a.id,a.user_id,a.tournament_id,p.full_name,p.email,t.title,a.created_at
    FROM public.tournament_ajk_applications a JOIN public.profiles p ON p.id=a.user_id JOIN public.tournaments t ON t.id=a.tournament_id
    WHERE a.status='PENDING' ORDER BY a.created_at;
END;
$$;

CREATE FUNCTION private.is_eligible_tournament_official(target UUID,event_uuid UUID) RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT EXISTS(SELECT 1 FROM public.user_roles r WHERE r.user_id=target AND (
    (r.role_code='SYSTEM_ADMIN' AND (r.source='PROFILE' OR (r.source='ADVISOR' AND private.is_verified_backup_manager(target))))
    OR (r.role_code IN ('EXCO','AJK') AND (r.tournament_id IS NULL OR r.tournament_id=event_uuid))));
$$;
REVOKE ALL ON FUNCTION private.is_eligible_tournament_official(UUID,UUID) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.tournament_officials(tournament_uuid UUID)
RETURNS TABLE(id UUID,full_name VARCHAR,email VARCHAR,organizational_role TEXT,organizational_role_detail TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NOT private.is_committee_member() THEN RAISE EXCEPTION 'MT or System Admin access is required.' USING ERRCODE='42501'; END IF;
  RETURN QUERY SELECT p.id,p.full_name,p.email,
    CASE WHEN p.is_admin OR private.is_verified_backup_manager(p.id) THEN 'SYSTEM_ADMIN' WHEN p.organizational_role='PLAYER' THEN 'AJK' ELSE p.organizational_role END,
    CASE WHEN p.is_admin OR private.is_verified_backup_manager(p.id) THEN 'System administrator' WHEN p.organizational_role='PLAYER' THEN 'Approved for this tournament' ELSE p.organizational_role_detail END
    FROM public.profiles p WHERE private.is_eligible_tournament_official(p.id,tournament_uuid) ORDER BY p.full_name;
END;
$$;

CREATE OR REPLACE FUNCTION private.is_authorized_match_operator(match_uuid UUID) RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT private.is_committee_member() OR EXISTS(SELECT 1 FROM public.matches m JOIN public.categories c ON c.id=m.category_id
    WHERE m.id=match_uuid AND m.umpire_id=auth.uid() AND private.is_eligible_tournament_official(auth.uid(),c.tournament_id));
$$;

CREATE FUNCTION private.sync_match_duty_roles() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE event_uuid UUID;
BEGIN
  SELECT tournament_id INTO event_uuid FROM public.categories WHERE id=NEW.category_id;
  DELETE FROM public.user_roles WHERE match_id=NEW.id AND source='MATCH';
  IF NEW.umpire_id IS NOT NULL THEN INSERT INTO public.user_roles(user_id,role_code,tournament_id,match_id,source) VALUES(NEW.umpire_id,'UMPIRE',event_uuid,NEW.id,'MATCH'); END IF;
  IF NEW.linesman_id IS NOT NULL THEN INSERT INTO public.user_roles(user_id,role_code,tournament_id,match_id,source) VALUES(NEW.linesman_id,'LINESMAN',event_uuid,NEW.id,'MATCH'); END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.sync_match_duty_roles() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER sync_match_roles AFTER INSERT OR UPDATE OF umpire_id,linesman_id,category_id ON public.matches FOR EACH ROW EXECUTE FUNCTION private.sync_match_duty_roles();
INSERT INTO public.user_roles(user_id,role_code,tournament_id,match_id,source)
  SELECT m.umpire_id,'UMPIRE',c.tournament_id,m.id,'MATCH' FROM public.matches m JOIN public.categories c ON c.id=m.category_id WHERE m.umpire_id IS NOT NULL
  UNION ALL SELECT m.linesman_id,'LINESMAN',c.tournament_id,m.id,'MATCH' FROM public.matches m JOIN public.categories c ON c.id=m.category_id WHERE m.linesman_id IS NOT NULL;

-- Preserve the old RPC shape while exposing verified advisor authority to all
-- existing authorization code. The real name and global organization role stay unchanged.
CREATE OR REPLACE FUNCTION public.current_actor_profile()
RETURNS TABLE(id UUID,full_name VARCHAR,email VARCHAR,matric_number VARCHAR,is_admin BOOLEAN,is_community_member BOOLEAN,created_at TIMESTAMPTZ,organizational_role TEXT,organizational_role_detail TEXT)
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT p.id,p.full_name,p.email,p.matric_number,private.is_platform_admin(),p.is_community_member,p.created_at,p.organizational_role,p.organizational_role_detail
    FROM public.profiles p WHERE p.id=auth.uid();
$$;

CREATE FUNCTION public.current_user_access()
RETURNS TABLE(id UUID,full_name VARCHAR,email VARCHAR,matric_number VARCHAR,is_admin BOOLEAN,is_community_member BOOLEAN,created_at TIMESTAMPTZ,
  organizational_role TEXT,organizational_role_detail TEXT,user_role TEXT,tournament_ajk_ids UUID[],authorized_umpire_match_ids UUID[],authorized_linesman_match_ids UUID[])
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT p.*,
    CASE WHEN p.is_admin THEN 'SYSTEM_ADMIN' WHEN p.organizational_role='MT' THEN 'MT'
      WHEN p.organizational_role='AJK' OR EXISTS(SELECT 1 FROM public.user_roles r WHERE r.user_id=auth.uid() AND r.role_code='AJK') THEN 'AJK'
      ELSE p.organizational_role END,
    ARRAY(SELECT r.tournament_id FROM public.user_roles r WHERE r.user_id=auth.uid() AND r.role_code='AJK' AND r.tournament_id IS NOT NULL AND r.match_id IS NULL),
    ARRAY(SELECT r.match_id FROM public.user_roles r WHERE r.user_id=auth.uid() AND r.role_code='UMPIRE' AND private.is_eligible_tournament_official(auth.uid(),r.tournament_id)),
    ARRAY(SELECT r.match_id FROM public.user_roles r WHERE r.user_id=auth.uid() AND r.role_code='LINESMAN' AND private.is_eligible_tournament_official(auth.uid(),r.tournament_id))
    FROM public.current_actor_profile() p;
$$;

REVOKE ALL ON FUNCTION public.apply_for_tournament_ajk(UUID),public.review_tournament_ajk(UUID,BOOLEAN),
  public.list_pending_tournament_ajk(),public.tournament_officials(UUID),public.current_user_access() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.apply_for_tournament_ajk(UUID),public.review_tournament_ajk(UUID,BOOLEAN),
  public.list_pending_tournament_ajk(),public.tournament_officials(UUID),public.current_user_access() TO authenticated;

-- Existing assignment/scheduling functions follow below, retaining conflict,
-- rest-buffer and self-officiating checks with tournament-scoped eligibility.

CREATE OR REPLACE FUNCTION public.assign_match_officials(
  match_uuid UUID,
  umpire_uuid UUID,
  linesman_uuid UUID
)
RETURNS TABLE (
  id UUID,
  umpire_id UUID,
  linesman_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  match_record public.matches%ROWTYPE;
  tournament_id UUID;
  scheduled_start TIMESTAMP WITH TIME ZONE;
BEGIN
  IF NOT (SELECT private.is_committee_member()) THEN
    RAISE EXCEPTION 'Administrator access is required.'
      USING ERRCODE = '42501';
  END IF;

  IF umpire_uuid IS NOT NULL AND umpire_uuid = linesman_uuid THEN
    RAISE EXCEPTION 'Choose different people for umpire and linesman.'
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

  IF match_record.status <> 'SCHEDULED' THEN
    RAISE EXCEPTION 'Officials can only be changed before a match begins.'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT category.tournament_id
  INTO tournament_id
  FROM public.categories AS category
  WHERE category.id = match_record.category_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tournament not found.'
      USING ERRCODE = 'P0002';
  END IF;

  IF umpire_uuid IN (match_record.player_a_id, match_record.player_b_id)
     OR linesman_uuid IN (match_record.player_a_id, match_record.player_b_id) THEN
    RAISE EXCEPTION 'A player cannot officiate their own match.'
      USING ERRCODE = '22023';
  END IF;

  IF umpire_uuid IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.profiles AS profile
    WHERE profile.id = umpire_uuid AND private.is_eligible_tournament_official(profile.id,(SELECT c.tournament_id FROM public.categories c WHERE c.id=match_record.category_id))
  ) THEN
    RAISE EXCEPTION 'The selected umpire is not on the officials roster.'
      USING ERRCODE = '22023';
  END IF;

  IF linesman_uuid IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.profiles AS profile
    WHERE profile.id = linesman_uuid AND private.is_eligible_tournament_official(profile.id,(SELECT c.tournament_id FROM public.categories c WHERE c.id=match_record.category_id))
  ) THEN
    RAISE EXCEPTION 'The selected linesman is not on the officials roster.'
      USING ERRCODE = '22023';
  END IF;

  -- Serialize schedule/official mutations so cross-category resource checks see committed state.
  PERFORM pg_advisory_xact_lock(hashtextextended('umpsace:match-scheduling', 0));
  scheduled_start := match_record.scheduled_time;

  IF scheduled_start IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM public.matches AS other_match
      WHERE other_match.id <> match_record.id
        AND other_match.status NOT IN ('CANCELLED', 'POSTPONED')
        AND other_match.scheduled_time IS NOT NULL
        AND (
          other_match.umpire_id = umpire_uuid
          OR other_match.linesman_id = umpire_uuid
          OR other_match.umpire_id = linesman_uuid
          OR other_match.linesman_id = linesman_uuid
        )
        AND tstzrange(other_match.scheduled_time, other_match.scheduled_time + INTERVAL '40 minutes', '[)')
          && tstzrange(scheduled_start, scheduled_start + INTERVAL '40 minutes', '[)')
    ) THEN
      RAISE EXCEPTION 'An assigned official is already officiating at this time.'
        USING ERRCODE = 'P0001';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.matches AS other_match
      WHERE other_match.id <> match_record.id
        AND other_match.status NOT IN ('CANCELLED', 'POSTPONED')
        AND other_match.scheduled_time IS NOT NULL
        AND (
          (other_match.umpire_id IN (match_record.player_a_id, match_record.player_b_id)
            AND abs(extract(epoch FROM (other_match.scheduled_time - scheduled_start))) < 70 * 60)
          OR
          (other_match.linesman_id IN (match_record.player_a_id, match_record.player_b_id)
            AND abs(extract(epoch FROM (other_match.scheduled_time - scheduled_start))) < 70 * 60)
          OR
          (umpire_uuid IN (other_match.player_a_id, other_match.player_b_id)
            AND abs(extract(epoch FROM (other_match.scheduled_time - scheduled_start))) < 70 * 60)
          OR
          (linesman_uuid IN (other_match.player_a_id, other_match.player_b_id)
            AND abs(extract(epoch FROM (other_match.scheduled_time - scheduled_start))) < 70 * 60)
        )
    ) THEN
      RAISE EXCEPTION 'The player and official assignments do not meet the required time buffer.'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  UPDATE public.matches AS match
  SET umpire_id = umpire_uuid,
      linesman_id = linesman_uuid
  WHERE match.id = match_uuid;

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
    'MATCH_OFFICIALS_ASSIGNED',
    'match',
    match_uuid,
    jsonb_build_object('umpire_id', match_record.umpire_id, 'linesman_id', match_record.linesman_id),
    jsonb_build_object('umpire_id', umpire_uuid, 'linesman_id', linesman_uuid)
  );

  RETURN QUERY
  SELECT match_record.id, umpire_uuid, linesman_uuid;
END;
$$;

CREATE OR REPLACE FUNCTION public.schedule_match(
  match_uuid UUID,
  court_value INTEGER,
  start_time TIMESTAMP WITH TIME ZONE,
  umpire_uuid UUID,
  linesman_uuid UUID
)
RETURNS TABLE (
  id UUID,
  court_number INTEGER,
  scheduled_time TIMESTAMP WITH TIME ZONE,
  estimated_start_time TIMESTAMP WITH TIME ZONE
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  match_record public.matches%ROWTYPE;
  tournament_record public.tournaments%ROWTYPE;
BEGIN
  IF NOT (SELECT private.is_committee_member()) THEN
    RAISE EXCEPTION 'Administrator access is required.'
      USING ERRCODE = '42501';
  END IF;

  IF start_time IS NULL OR court_value IS NULL OR court_value < 1 OR umpire_uuid = linesman_uuid THEN
    RAISE EXCEPTION 'Court and official assignments are invalid.'
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

  IF match_record.status <> 'SCHEDULED' THEN
    RAISE EXCEPTION 'Ready, active, and completed match allocations are locked.'
      USING ERRCODE = 'P0001';
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

  IF court_value > tournament_record.court_count THEN
    RAISE EXCEPTION 'Court number exceeds the tournament court count.'
      USING ERRCODE = '22023';
  END IF;

  IF start_time < tournament_record.start_date
     OR start_time + INTERVAL '40 minutes' > tournament_record.end_date THEN
    RAISE EXCEPTION 'Match time and its 40-minute block must fall within the tournament dates.'
      USING ERRCODE = '22023';
  END IF;

  IF umpire_uuid IN (match_record.player_a_id, match_record.player_b_id)
     OR linesman_uuid IN (match_record.player_a_id, match_record.player_b_id) THEN
    RAISE EXCEPTION 'A player cannot officiate their own match.'
      USING ERRCODE = '22023';
  END IF;

  IF umpire_uuid IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.profiles AS profile
    WHERE profile.id = umpire_uuid AND private.is_eligible_tournament_official(profile.id,(SELECT c.tournament_id FROM public.categories c WHERE c.id=match_record.category_id))
  ) THEN
    RAISE EXCEPTION 'The selected umpire is not on the officials roster.'
      USING ERRCODE = '22023';
  END IF;

  IF linesman_uuid IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.profiles AS profile
    WHERE profile.id = linesman_uuid AND private.is_eligible_tournament_official(profile.id,(SELECT c.tournament_id FROM public.categories c WHERE c.id=match_record.category_id))
  ) THEN
    RAISE EXCEPTION 'The selected linesman is not on the officials roster.'
      USING ERRCODE = '22023';
  END IF;

  -- Serialize schedule/official mutations so cross-category resource checks see committed state.
  PERFORM pg_advisory_xact_lock(hashtextextended('umpsace:match-scheduling', 0));

  IF EXISTS (
    SELECT 1
    FROM public.matches AS other_match
    WHERE other_match.category_id IN (
        SELECT category.id
        FROM public.categories AS category
        WHERE category.tournament_id = tournament_record.id
      )
      AND other_match.id <> match_record.id
      AND other_match.status NOT IN ('CANCELLED', 'POSTPONED')
      AND other_match.court_number = court_value
      AND other_match.scheduled_time IS NOT NULL
      AND tstzrange(other_match.scheduled_time, other_match.scheduled_time + INTERVAL '40 minutes', '[)')
        && tstzrange(start_time, start_time + INTERVAL '40 minutes', '[)')
  ) THEN
    RAISE EXCEPTION 'The selected court is already occupied at this time.'
      USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.matches AS other_match
    WHERE other_match.id <> match_record.id
      AND other_match.status NOT IN ('CANCELLED', 'POSTPONED')
      AND other_match.scheduled_time IS NOT NULL
      AND (
        other_match.player_a_id IN (match_record.player_a_id, match_record.player_b_id)
        OR other_match.player_b_id IN (match_record.player_a_id, match_record.player_b_id)
      )
      AND NOT (
        start_time + INTERVAL '60 minutes' <= other_match.scheduled_time
        OR other_match.scheduled_time + INTERVAL '60 minutes' <= start_time
      )
  ) THEN
    RAISE EXCEPTION 'A competitor is double-booked or does not have enough rest.'
      USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.matches AS other_match
    WHERE other_match.id <> match_record.id
      AND other_match.status NOT IN ('CANCELLED', 'POSTPONED')
      AND other_match.scheduled_time IS NOT NULL
      AND (
        other_match.umpire_id = umpire_uuid
        OR other_match.linesman_id = umpire_uuid
        OR other_match.umpire_id = linesman_uuid
        OR other_match.linesman_id = linesman_uuid
      )
      AND tstzrange(other_match.scheduled_time, other_match.scheduled_time + INTERVAL '40 minutes', '[)')
        && tstzrange(start_time, start_time + INTERVAL '40 minutes', '[)')
  ) THEN
    RAISE EXCEPTION 'An assigned official is already officiating at this time.'
      USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.matches AS other_match
    WHERE other_match.id <> match_record.id
      AND other_match.status NOT IN ('CANCELLED', 'POSTPONED')
      AND other_match.scheduled_time IS NOT NULL
      AND (
        (other_match.umpire_id IN (match_record.player_a_id, match_record.player_b_id)
          AND abs(extract(epoch FROM (other_match.scheduled_time - start_time))) < 70 * 60)
        OR (other_match.linesman_id IN (match_record.player_a_id, match_record.player_b_id)
          AND abs(extract(epoch FROM (other_match.scheduled_time - start_time))) < 70 * 60)
        OR (umpire_uuid IN (other_match.player_a_id, other_match.player_b_id)
          AND abs(extract(epoch FROM (other_match.scheduled_time - start_time))) < 70 * 60)
        OR (linesman_uuid IN (other_match.player_a_id, other_match.player_b_id)
          AND abs(extract(epoch FROM (other_match.scheduled_time - start_time))) < 70 * 60)
      )
  ) THEN
    RAISE EXCEPTION 'The player and official assignments do not meet the required time buffer.'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.matches AS match
  SET court_number = court_value,
      scheduled_time = start_time,
      estimated_start_time = start_time,
      umpire_id = umpire_uuid,
      linesman_id = linesman_uuid
  WHERE match.id = match_uuid;

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
    'MATCH_SCHEDULED',
    'match',
    match_uuid,
    jsonb_build_object(
      'court_number', match_record.court_number,
      'scheduled_time', match_record.scheduled_time,
      'umpire_id', match_record.umpire_id,
      'linesman_id', match_record.linesman_id
    ),
    jsonb_build_object(
      'court_number', court_value,
      'scheduled_time', start_time,
      'umpire_id', umpire_uuid,
      'linesman_id', linesman_uuid
    )
  );

  RETURN QUERY SELECT match_uuid, court_value, start_time, start_time;
END;
$$;


COMMIT;
