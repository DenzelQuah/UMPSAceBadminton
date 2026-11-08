BEGIN;

-- The exact owner-approved exception. Auth email confirmation is still required;
-- neither profile email fields nor editable signup metadata grant this access.
CREATE OR REPLACE FUNCTION private.backup_manager_email() RETURNS TEXT
LANGUAGE SQL IMMUTABLE SET search_path='' AS $$ SELECT 'prodenzel992@gmail.com'::TEXT; $$;
REVOKE ALL ON FUNCTION private.backup_manager_email() FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION private.is_verified_backup_manager(target UUID) RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT EXISTS(SELECT 1 FROM auth.users u WHERE u.id=target
    AND lower(trim(u.email))=private.backup_manager_email()
    AND to_jsonb(u)->>'email_confirmed_at' IS NOT NULL);
$$;
REVOKE ALL ON FUNCTION private.is_verified_backup_manager(UUID) FROM PUBLIC,anon,authenticated,service_role;

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS check_umpsa_email;
ALTER TABLE public.profiles ADD CONSTRAINT check_umpsa_email CHECK(
  email ~* '^[^[:space:]]+@(adab\.)?umpsa\.edu\.my$' OR lower(trim(email))='prodenzel992@gmail.com'
);

INSERT INTO public.profiles(id,full_name,email,matric_number,is_admin,is_community_member)
  SELECT u.id,left(coalesce(nullif(trim(u.raw_user_meta_data->>'full_name'),''),split_part(lower(trim(u.email)),'@',1)),255),lower(trim(u.email)),NULL,FALSE,FALSE
  FROM auth.users u WHERE lower(trim(u.email))=private.backup_manager_email() AND NOT EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=u.id)
  ON CONFLICT(id) DO NOTHING;

CREATE OR REPLACE FUNCTION private.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  normalized_email TEXT;
  profile_name TEXT;
  profile_matric_number TEXT;
BEGIN
  normalized_email := lower(trim(NEW.email));

  IF normalized_email IS NULL OR (normalized_email !~* '^[^[:space:]]+@(adab\.)?umpsa\.edu\.my$' AND normalized_email<>private.backup_manager_email()) THEN
    RAISE EXCEPTION 'Use an institutional email or the approved backup manager address.'
      USING ERRCODE = '42501';
  END IF;

  profile_name := coalesce(
    nullif(trim(NEW.raw_user_meta_data ->> 'full_name'), ''),
    split_part(normalized_email, '@', 1)
  );
  profile_matric_number := nullif(
    trim(NEW.raw_user_meta_data ->> 'matric_number'),
    ''
  );

  INSERT INTO public.profiles (
    id,
    full_name,
    email,
    matric_number,
    is_admin,
    is_community_member
  )
  VALUES (
    NEW.id,
    profile_name,
    normalized_email,
    profile_matric_number,
    FALSE,
    FALSE
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;


CREATE FUNCTION private.normalize_approved_role(value TEXT) RETURNS TEXT
LANGUAGE SQL IMMUTABLE SET search_path='' AS $$
  SELECT CASE upper(trim(value)) WHEN 'ADMIN' THEN 'SYSTEM_ADMIN' WHEN 'ADMINISTRATOR' THEN 'SYSTEM_ADMIN'
    WHEN 'PLATFORM_ADMIN' THEN 'SYSTEM_ADMIN' WHEN 'SYSTEM_ADMIN' THEN 'SYSTEM_ADMIN'
    WHEN 'MT' THEN 'MT' WHEN 'EXCO' THEN 'EXCO' WHEN 'AJK' THEN 'AJK' WHEN 'PLAYER' THEN 'PLAYER' ELSE NULL END;
$$;
CREATE FUNCTION private.highest_approved_role(values_array TEXT[]) RETURNS TEXT
LANGUAGE SQL IMMUTABLE SET search_path='' AS $$
  SELECT coalesce((SELECT role_value FROM (SELECT private.normalize_approved_role(value) AS role_value FROM unnest(values_array) value) roles
    WHERE role_value IS NOT NULL ORDER BY array_position(ARRAY['SYSTEM_ADMIN','MT','EXCO','AJK','PLAYER'],role_value) LIMIT 1),'PLAYER');
$$;
REVOKE ALL ON FUNCTION private.normalize_approved_role(TEXT),private.highest_approved_role(TEXT[]) FROM PUBLIC,anon,authenticated,service_role;

-- Import approved legacy database fields once. These columns do not exist in a
-- fresh schema, so JSON access keeps the upgrade compatible with both layouts.
-- Auth user_metadata is deliberately never consulted.
WITH approved_legacy AS (
  SELECT p.id,private.highest_approved_role(ARRAY[p.organizational_role,to_jsonb(p)->>'role',to_jsonb(p)->>'user_role']) AS role_value
  FROM public.profiles p
)
UPDATE public.profiles p SET is_admin=p.is_admin OR l.role_value='SYSTEM_ADMIN',
  organizational_role=CASE WHEN l.role_value='SYSTEM_ADMIN' THEN p.organizational_role ELSE l.role_value END
FROM approved_legacy l WHERE p.id=l.id AND (
  (l.role_value='SYSTEM_ADMIN' AND NOT p.is_admin) OR (l.role_value<>'SYSTEM_ADMIN' AND p.organizational_role IS DISTINCT FROM l.role_value)
);
DO $$ DECLARE field_name TEXT; BEGIN
  FOREACH field_name IN ARRAY ARRAY['role','user_role'] LOOP
    IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='profiles' AND column_name=field_name) THEN
      EXECUTE format('REVOKE UPDATE (%I) ON public.profiles FROM anon, authenticated',field_name);
    END IF;
  END LOOP;
END $$;

CREATE FUNCTION private.approved_global_role(target UUID) RETURNS TEXT
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE values_array TEXT[]; grants_array TEXT[];
BEGIN
  SELECT ARRAY[p.organizational_role,CASE WHEN p.is_admin THEN 'SYSTEM_ADMIN' END] INTO values_array FROM public.profiles p WHERE p.id=target;
  IF NOT FOUND THEN RETURN 'PLAYER'; END IF;
  IF private.is_verified_backup_manager(target) THEN RETURN 'SYSTEM_ADMIN'; END IF;
  -- The prior role-table migration may still be pending on an older hosted
  -- project. Approved profile roles keep working during that transition.
  IF to_regclass('public.user_roles') IS NOT NULL THEN
    EXECUTE 'SELECT array_agg(r.role_code) FROM public.user_roles r WHERE r.user_id=$1 AND r.tournament_id IS NULL AND r.match_id IS NULL AND r.source<>''ADVISOR'''
      INTO grants_array USING target;
    values_array:=values_array||coalesce(grants_array,ARRAY[]::TEXT[]);
  END IF;
  RETURN private.highest_approved_role(values_array);
END;
$$;
REVOKE ALL ON FUNCTION private.approved_global_role(UUID) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION private.is_platform_admin() RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT auth.uid() IS NOT NULL AND private.approved_global_role(auth.uid())='SYSTEM_ADMIN';
$$;
CREATE OR REPLACE FUNCTION private.is_committee_member() RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT auth.uid() IS NOT NULL AND private.approved_global_role(auth.uid()) IN('SYSTEM_ADMIN','MT');
$$;

CREATE OR REPLACE FUNCTION public.current_actor_profile()
RETURNS TABLE(id UUID,full_name VARCHAR,email VARCHAR,matric_number VARCHAR,is_admin BOOLEAN,is_community_member BOOLEAN,created_at TIMESTAMPTZ,organizational_role TEXT,organizational_role_detail TEXT)
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT p.id,p.full_name,p.email,p.matric_number,r.role_value='SYSTEM_ADMIN',
    p.is_community_member OR r.role_value IN('EXCO','AJK'),p.created_at,
    CASE WHEN r.role_value='SYSTEM_ADMIN' THEN p.organizational_role ELSE r.role_value END,p.organizational_role_detail
  FROM public.profiles p CROSS JOIN LATERAL(SELECT private.approved_global_role(p.id) AS role_value) r WHERE p.id=auth.uid();
$$;

-- Reconcile already registered verified advisors without changing Auth records
-- or permanently promoting a profile flag. Changing Auth email removes bypass.
DO $$ BEGIN
  IF to_regclass('public.user_roles') IS NOT NULL THEN
    EXECUTE 'DELETE FROM public.user_roles WHERE source=''ADVISOR'' AND NOT private.is_verified_backup_manager(user_id)';
    EXECUTE 'INSERT INTO public.user_roles(user_id,role_code,source) SELECT p.id,''SYSTEM_ADMIN'',''ADVISOR'' FROM public.profiles p WHERE private.is_verified_backup_manager(p.id) ON CONFLICT DO NOTHING';
  END IF;
END $$;

COMMIT;
