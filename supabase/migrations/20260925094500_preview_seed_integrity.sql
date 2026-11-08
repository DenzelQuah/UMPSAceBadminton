-- Validate private draw-preview player and seed metadata against registrations.
-- This keeps a direct administrator caller from inventing preview seed data while
-- allowing profile display names to change after publication.

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
           AND profile.full_name IS DISTINCT FROM preview_players.full_name
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

REVOKE ALL ON FUNCTION private.validate_category_draw_preview() FROM PUBLIC;
DROP TRIGGER IF EXISTS category_draw_previews_metadata_guard ON public.category_draw_previews;
CREATE TRIGGER category_draw_previews_metadata_guard
  BEFORE INSERT OR UPDATE ON public.category_draw_previews
  FOR EACH ROW
  EXECUTE FUNCTION private.validate_category_draw_preview();
