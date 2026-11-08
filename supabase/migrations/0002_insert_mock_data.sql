-- Insert a mock tournament
INSERT INTO public.tournaments (id, title, description, location, court_count, start_date, end_date, created_at)
VALUES (
  gen_random_uuid(),
  'UMPSA Open Championship 2026',
  'Annual badminton championship at UMPSA Sports Complex.',
  'UMPSA Sports Complex',
  6,
  NOW(),
  NOW() + INTERVAL '7 days',
  NOW()
);

-- Insert mock categories for the tournament
INSERT INTO public.categories (id, tournament_id, name, max_capacity, group_count, qualifiers_per_group, format, status, created_at)
SELECT
  gen_random_uuid(),
  t.id,
  category_name,
  16,
  4,
  1,
  'STANDARD_3X21',
  'DRAFT',
  NOW()
FROM (
  SELECT id FROM public.tournaments WHERE title = 'UMPSA Open Championship 2026'
) t,
(VALUES
  ('Men''s Singles'),
  ('Women''s Singles'),
  ('Men''s Doubles'),
  ('Women''s Doubles'),
  ('Mixed Doubles')
) AS categories(category_name);