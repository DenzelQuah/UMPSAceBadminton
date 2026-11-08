BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN organizational_role TEXT NOT NULL DEFAULT 'PLAYER' CHECK (organizational_role IN ('PLAYER','MT','EXCO','AJK')),
  ADD COLUMN organizational_role_detail TEXT NOT NULL DEFAULT '' CHECK (length(organizational_role_detail) <= 100);
REVOKE UPDATE (organizational_role, organizational_role_detail) ON public.profiles FROM anon, authenticated;

-- Preserve only the previously explicitly approved roster capability. No account
-- gets leadership or administrator access from its email or signup metadata.
UPDATE public.profiles SET organizational_role = 'EXCO', organizational_role_detail = 'Previously approved officials roster'
WHERE is_community_member = TRUE AND is_admin = FALSE;

CREATE TABLE public.organization_role_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  requested_role TEXT NOT NULL CHECK (requested_role IN ('MT','EXCO','AJK')),
  role_detail TEXT NOT NULL CHECK (length(trim(role_detail)) BETWEEN 2 AND 100),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED','CANCELLED')),
  reviewed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  review_note TEXT NOT NULL DEFAULT '' CHECK (length(review_note) <= 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ
);
ALTER TABLE public.organization_role_requests ENABLE ROW LEVEL SECURITY;
CREATE UNIQUE INDEX one_pending_organization_request ON public.organization_role_requests(user_id) WHERE status = 'PENDING';
REVOKE ALL ON public.organization_role_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.organization_role_requests TO authenticated;

CREATE FUNCTION private.is_platform_admin()
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS(SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = TRUE);
$$;
REVOKE ALL ON FUNCTION private.is_platform_admin() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.is_platform_admin() TO authenticated;

CREATE OR REPLACE FUNCTION private.is_committee_member()
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS(SELECT 1 FROM public.profiles WHERE id = auth.uid() AND (is_admin = TRUE OR organizational_role = 'MT'));
$$;

CREATE POLICY role_request_owner_or_admin ON public.organization_role_requests FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR private.is_platform_admin());

CREATE FUNCTION public.current_actor_profile()
RETURNS TABLE(id UUID, full_name VARCHAR, email VARCHAR, matric_number VARCHAR, is_admin BOOLEAN,
  is_community_member BOOLEAN, created_at TIMESTAMPTZ, organizational_role TEXT, organizational_role_detail TEXT)
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p.id,p.full_name,p.email,p.matric_number,p.is_admin,p.is_community_member,p.created_at,p.organizational_role,p.organizational_role_detail
  FROM public.profiles p WHERE p.id = auth.uid();
$$;

CREATE FUNCTION public.submit_organization_role_request(role_value TEXT, detail_value TEXT)
RETURNS public.organization_role_requests LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE request_record public.organization_role_requests%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in first.' USING ERRCODE='42501'; END IF;
  IF role_value IS NULL OR role_value NOT IN ('MT','EXCO','AJK') OR detail_value IS NULL OR length(trim(detail_value)) NOT BETWEEN 2 AND 100 THEN
    RAISE EXCEPTION 'Choose an organizational role and a position or team.' USING ERRCODE='22023'; END IF;
  PERFORM 1 FROM public.profiles WHERE id=auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Profile not found.' USING ERRCODE='P0002'; END IF;
  IF private.is_platform_admin() THEN RAISE EXCEPTION 'Administrators already have platform access.' USING ERRCODE='22023'; END IF;
  INSERT INTO public.organization_role_requests(user_id,requested_role,role_detail)
    VALUES(auth.uid(),role_value,trim(detail_value))
    ON CONFLICT(user_id) WHERE status='PENDING' DO UPDATE
      SET requested_role=EXCLUDED.requested_role, role_detail=EXCLUDED.role_detail, created_at=now()
    RETURNING * INTO request_record;
  RETURN request_record;
END;
$$;

CREATE FUNCTION public.review_organization_role_request(request_uuid UUID, approve BOOLEAN, note_value TEXT DEFAULT '')
RETURNS public.organization_role_requests LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE request_record public.organization_role_requests%ROWTYPE; previous_profile public.profiles%ROWTYPE; next_profile public.profiles%ROWTYPE;
BEGIN
  IF NOT private.is_platform_admin() THEN RAISE EXCEPTION 'Only a platform administrator can approve organizational roles.' USING ERRCODE='42501'; END IF;
  IF approve IS NULL OR length(coalesce(note_value,'')) > 500 THEN RAISE EXCEPTION 'Choose a decision and a valid review note.' USING ERRCODE='22023'; END IF;
  SELECT * INTO request_record FROM public.organization_role_requests WHERE id=request_uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found.' USING ERRCODE='P0002'; END IF;
  IF request_record.user_id=auth.uid() THEN RAISE EXCEPTION 'An administrator cannot review their own request.' USING ERRCODE='42501'; END IF;
  SELECT * INTO previous_profile FROM public.profiles WHERE id=request_record.user_id FOR UPDATE;
  SELECT * INTO request_record FROM public.organization_role_requests WHERE id=request_uuid FOR UPDATE;
  IF request_record.status <> 'PENDING' THEN RAISE EXCEPTION 'This request has already been reviewed.' USING ERRCODE='P0001'; END IF;
  IF approve THEN
    UPDATE public.profiles SET organizational_role=request_record.requested_role,
      organizational_role_detail=request_record.role_detail,
      is_community_member=request_record.requested_role IN ('EXCO','AJK'), updated_at=now()
    WHERE id=request_record.user_id RETURNING * INTO next_profile;
  ELSE next_profile := previous_profile;
  END IF;
  UPDATE public.organization_role_requests SET status=CASE WHEN approve THEN 'APPROVED' ELSE 'REJECTED' END,
    reviewed_by=auth.uid(),review_note=coalesce(trim(note_value),''),reviewed_at=now()
    WHERE id=request_uuid RETURNING * INTO request_record;
  INSERT INTO public.audit_logs(actor_id,action,entity_type,entity_id,original_data,new_data,reason)
    VALUES(auth.uid(),CASE WHEN approve THEN 'ORGANIZATION_ROLE_APPROVED' ELSE 'ORGANIZATION_ROLE_REJECTED' END,
      'profile',request_record.user_id,to_jsonb(previous_profile),to_jsonb(next_profile),
      coalesce(nullif(trim(note_value),''),'Administrator reviewed the organizational access request.'));
  RETURN request_record;
END;
$$;

CREATE FUNCTION public.revoke_organization_role(profile_uuid UUID, reason_value TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE previous_profile public.profiles%ROWTYPE;
BEGIN
  IF NOT private.is_platform_admin() OR profile_uuid=auth.uid() THEN RAISE EXCEPTION 'Only an administrator can revoke another member.' USING ERRCODE='42501'; END IF;
  IF reason_value IS NULL OR length(trim(reason_value)) < 10 THEN RAISE EXCEPTION 'Provide a reason of at least ten characters.' USING ERRCODE='22023'; END IF;
  SELECT * INTO previous_profile FROM public.profiles WHERE id=profile_uuid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Profile not found.' USING ERRCODE='P0002'; END IF;
  IF previous_profile.is_admin THEN RAISE EXCEPTION 'Platform administrator access cannot be changed here.' USING ERRCODE='42501'; END IF;
  UPDATE public.profiles SET organizational_role='PLAYER',organizational_role_detail='',is_community_member=FALSE,updated_at=now() WHERE id=profile_uuid;
  UPDATE public.organization_role_requests SET status='CANCELLED',reviewed_by=auth.uid(),reviewed_at=now(),review_note='Access revoked by administrator.' WHERE user_id=profile_uuid AND status='PENDING';
  INSERT INTO public.audit_logs(actor_id,action,entity_type,entity_id,original_data,new_data,reason)
    VALUES(auth.uid(),'ORGANIZATION_ROLE_REVOKED','profile',profile_uuid,to_jsonb(previous_profile),
      jsonb_build_object('organizational_role','PLAYER','is_community_member',FALSE),trim(reason_value));
END;
$$;

CREATE FUNCTION public.my_organization_role_requests()
RETURNS SETOF public.organization_role_requests LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT r.* FROM public.organization_role_requests r WHERE r.user_id=auth.uid() ORDER BY r.created_at DESC;
$$;

CREATE FUNCTION public.list_organization_role_requests()
RETURNS TABLE(id UUID,user_id UUID,full_name VARCHAR,email VARCHAR,requested_role TEXT,role_detail TEXT,status TEXT,review_note TEXT,created_at TIMESTAMPTZ)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT private.is_platform_admin() THEN RAISE EXCEPTION 'Administrator approval access required.' USING ERRCODE='42501'; END IF;
  RETURN QUERY SELECT r.id,r.user_id,p.full_name,p.email,r.requested_role,r.role_detail,r.status,r.review_note,r.created_at
    FROM public.organization_role_requests r JOIN public.profiles p ON p.id=r.user_id
    ORDER BY (r.status='PENDING') DESC,r.created_at DESC;
END;
$$;

CREATE FUNCTION public.list_organization_members()
RETURNS TABLE(id UUID,full_name VARCHAR,email VARCHAR,organizational_role TEXT,organizational_role_detail TEXT,is_admin BOOLEAN)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT private.is_platform_admin() THEN RAISE EXCEPTION 'Administrator approval access required.' USING ERRCODE='42501'; END IF;
  RETURN QUERY SELECT p.id,p.full_name,p.email,p.organizational_role,p.organizational_role_detail,p.is_admin FROM public.profiles p ORDER BY p.full_name;
END;
$$;

-- Signup metadata expresses a request only. It is never an authorization claim.
CREATE FUNCTION private.queue_signup_role_request()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE metadata JSONB; requested TEXT; detail TEXT;
BEGIN
  SELECT u.raw_user_meta_data INTO metadata FROM auth.users u WHERE u.id=NEW.id;
  requested := metadata ->> 'requested_organizational_role';
  detail := trim(metadata ->> 'requested_role_detail');
  IF requested IN ('MT','EXCO','AJK') AND length(detail) BETWEEN 2 AND 100 THEN
    INSERT INTO public.organization_role_requests(user_id,requested_role,role_detail) VALUES(NEW.id,requested,detail)
      ON CONFLICT(user_id) WHERE status='PENDING' DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER queue_signup_organization_request AFTER INSERT ON public.profiles FOR EACH ROW EXECUTE FUNCTION private.queue_signup_role_request();
REVOKE ALL ON FUNCTION private.queue_signup_role_request() FROM PUBLIC,anon,authenticated,service_role;

INSERT INTO public.organization_role_requests(user_id,requested_role,role_detail)
SELECT p.id,u.raw_user_meta_data->>'requested_organizational_role',trim(u.raw_user_meta_data->>'requested_role_detail')
FROM public.profiles p JOIN auth.users u ON u.id=p.id
WHERE p.organizational_role='PLAYER' AND NOT p.is_admin
  AND u.raw_user_meta_data->>'requested_organizational_role' IN ('MT','EXCO','AJK')
  AND length(trim(u.raw_user_meta_data->>'requested_role_detail')) BETWEEN 2 AND 100
ON CONFLICT(user_id) WHERE status='PENDING' DO NOTHING;

-- The former umpire/linesman development identities enter the same approval queue.
UPDATE public.profiles SET full_name='Codex Test MT'
WHERE email='codex-test-umpire@umpsa.edu.my' AND lower(full_name) IN ('codex test umpire','codex test mt');
UPDATE public.profiles SET full_name='Codex Test EXCO'
WHERE email='codex-test-linesman@umpsa.edu.my' AND lower(full_name) IN ('codex test linesman','codex test exco');
INSERT INTO public.organization_role_requests(user_id,requested_role,role_detail)
SELECT p.id,CASE WHEN p.email='codex-test-umpire@umpsa.edu.my' THEN 'MT' ELSE 'EXCO' END,
  CASE WHEN p.email='codex-test-umpire@umpsa.edu.my' THEN 'Other Majlis Tertinggi' ELSE 'Technical' END
FROM public.profiles p WHERE p.email IN ('codex-test-umpire@umpsa.edu.my','codex-test-linesman@umpsa.edu.my') AND p.organizational_role='PLAYER' AND NOT p.is_admin
ON CONFLICT(user_id) WHERE status='PENDING' DO NOTHING;

CREATE OR REPLACE FUNCTION public.available_officials()
RETURNS TABLE(id UUID,full_name VARCHAR,email VARCHAR)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT private.is_committee_member() THEN RAISE EXCEPTION 'Tournament management access required.' USING ERRCODE='42501'; END IF;
  RETURN QUERY SELECT p.id,p.full_name,p.email FROM public.profiles p
    WHERE p.is_admin OR p.organizational_role IN ('EXCO','AJK') ORDER BY p.full_name;
END;
$$;

-- Disable the old roster switch as a path around organizational approval.
CREATE FUNCTION public.approved_organization_officials()
RETURNS TABLE(id UUID,full_name VARCHAR,email VARCHAR,organizational_role TEXT,organizational_role_detail TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT private.is_committee_member() THEN RAISE EXCEPTION 'Tournament management access required.' USING ERRCODE='42501'; END IF;
  RETURN QUERY SELECT p.id,p.full_name,p.email,p.organizational_role,p.organizational_role_detail
    FROM public.profiles p WHERE p.is_admin OR p.organizational_role IN ('EXCO','AJK') ORDER BY p.full_name;
END;
$$;
REVOKE ALL ON FUNCTION public.approved_organization_officials() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.approved_organization_officials() TO authenticated;

CREATE OR REPLACE FUNCTION public.set_community_membership(target_profile_id UUID,enabled BOOLEAN)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT private.is_platform_admin() THEN RAISE EXCEPTION 'Only administrators approve organizational access.' USING ERRCODE='42501'; END IF;
  RAISE EXCEPTION 'Use the organizational role approval workflow.' USING ERRCODE='22023';
END;
$$;

CREATE OR REPLACE FUNCTION private.is_authorized_match_operator(match_uuid UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT private.is_committee_member() OR EXISTS(
    SELECT 1 FROM public.matches m JOIN public.profiles p ON p.id=m.umpire_id
    WHERE m.id=match_uuid AND m.umpire_id=auth.uid() AND p.organizational_role IN ('EXCO','AJK')
  );
$$;

REVOKE ALL ON FUNCTION public.current_actor_profile(),public.submit_organization_role_request(TEXT,TEXT),
  public.review_organization_role_request(UUID,BOOLEAN,TEXT),public.revoke_organization_role(UUID,TEXT),
  public.my_organization_role_requests(),public.list_organization_role_requests(),public.list_organization_members()
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.current_actor_profile(),public.submit_organization_role_request(TEXT,TEXT),
  public.review_organization_role_request(UUID,BOOLEAN,TEXT),public.revoke_organization_role(UUID,TEXT),
  public.my_organization_role_requests(),public.list_organization_role_requests(),public.list_organization_members()
  TO authenticated;

-- Assignment functions below continue to enforce the existing timing/rest and
-- self-officiating rules; only their eligible-roster predicate changes.

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
    WHERE profile.id = umpire_uuid AND (profile.is_admin = TRUE OR profile.organizational_role IN ('EXCO','AJK'))
  ) THEN
    RAISE EXCEPTION 'The selected umpire is not on the officials roster.'
      USING ERRCODE = '22023';
  END IF;

  IF linesman_uuid IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.profiles AS profile
    WHERE profile.id = linesman_uuid AND (profile.is_admin = TRUE OR profile.organizational_role IN ('EXCO','AJK'))
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
    WHERE profile.id = umpire_uuid AND (profile.is_admin = TRUE OR profile.organizational_role IN ('EXCO','AJK'))
  ) THEN
    RAISE EXCEPTION 'The selected umpire is not on the officials roster.'
      USING ERRCODE = '22023';
  END IF;

  IF linesman_uuid IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.profiles AS profile
    WHERE profile.id = linesman_uuid AND (profile.is_admin = TRUE OR profile.organizational_role IN ('EXCO','AJK'))
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

REVOKE ALL ON FUNCTION public.save_category_draw_preview(UUID, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_category_draw_preview(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.publish_category_draw(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assign_match_officials(UUID, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.schedule_match(UUID, INTEGER, TIMESTAMP WITH TIME ZONE, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_category_draw_preview(UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_category_draw_preview(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.publish_category_draw(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assign_match_officials(UUID, UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.schedule_match(UUID, INTEGER, TIMESTAMP WITH TIME ZONE, UUID, UUID) TO authenticated;

-- -----------------------------------------------------------------------------
-- Ranking publication
-- -----------------------------------------------------------------------------


COMMIT;
