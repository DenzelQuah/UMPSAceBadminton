-- ENUM Types
CREATE TYPE tournament_status AS ENUM (
  'DRAFT',
  'REGISTRATION_OPEN',
  'REGISTRATION_CLOSED',
  'DRAW_PREPARATION',
  'DRAW_GENERATED',
  'DRAW_PUBLISHED',
  'GROUP_STAGE_IN_PROGRESS',
  'GROUP_STAGE_COMPLETED',
  'KNOCKOUT_IN_PROGRESS',
  'COMPLETED',
  'ARCHIVED'
);

CREATE TYPE match_status AS ENUM (
  'SCHEDULED',
  'READY',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
  'POSTPONED',
  'WALKOVER',
  'RETIRED'
);

CREATE TYPE registration_status AS ENUM (
  'CONFIRMED',
  'WAITLISTED',
  'WITHDRAWN'
);

CREATE TYPE scoring_format AS ENUM (
  'STANDARD_3X21',
  'SINGLE_SET_1X30'
);

CREATE TYPE disciplinary_card AS ENUM (
  'YELLOW',
  'RED',
  'BLACK'
);

-- Profiles Table
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name VARCHAR(255) NOT NULL,
  matric_number VARCHAR(50) UNIQUE,
  email VARCHAR(255) NOT NULL UNIQUE,
  is_admin BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  CONSTRAINT check_umpsa_email CHECK (
    email LIKE '%@adab.umpsa.edu.my' OR 
    email LIKE '%@umpsa.edu.my'
  )
);

-- Tournaments Table
CREATE TABLE public.tournaments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(255) NOT NULL,
  description TEXT,
  location VARCHAR(255) NOT NULL,
  court_count INT NOT NULL CHECK (court_count > 0),
  start_date TIMESTAMP WITH TIME ZONE NOT NULL,
  end_date TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  CONSTRAINT check_dates CHECK (start_date <= end_date)
);

-- Categories Table
CREATE TABLE public.categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  max_capacity INT NOT NULL CHECK (max_capacity > 0),
  group_count INT NOT NULL CHECK (group_count > 0),
  qualifiers_per_group INT NOT NULL DEFAULT 1 CHECK (qualifiers_per_group > 0),
  format scoring_format NOT NULL DEFAULT 'STANDARD_3X21',
  status tournament_status NOT NULL DEFAULT 'DRAFT',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  CONSTRAINT unique_tournament_category UNIQUE (tournament_id, name)
);

-- Registrations Table
CREATE TABLE public.registrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status registration_status NOT NULL DEFAULT 'CONFIRMED',
  seed_number INT DEFAULT NULL CHECK (seed_number > 0),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  CONSTRAINT unique_player_category_reg UNIQUE (category_id, player_id),
  CONSTRAINT unique_seed_per_category UNIQUE (category_id, seed_number)
);

-- Groups Table
CREATE TABLE public.groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  name VARCHAR(50) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  CONSTRAINT unique_group_name UNIQUE (category_id, name)
);

-- Group Members Table
CREATE TABLE public.group_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  matches_played INT NOT NULL DEFAULT 0 CHECK (matches_played >= 0),
  matches_won INT NOT NULL DEFAULT 0 CHECK (matches_won >= 0),
  matches_lost INT NOT NULL DEFAULT 0 CHECK (matches_lost >= 0),
  points_won INT NOT NULL DEFAULT 0 CHECK (points_won >= 0),
  points_lost INT NOT NULL DEFAULT 0 CHECK (points_lost >= 0),
  net_points INT NOT NULL DEFAULT 0,
  standings_points INT NOT NULL DEFAULT 0 CHECK (standings_points >= 0),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  CONSTRAINT unique_player_per_group UNIQUE (group_id, player_id)
);

-- Matches Table
CREATE TABLE public.matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  group_id UUID REFERENCES public.groups(id) ON DELETE SET NULL,
  knockout_round INT DEFAULT NULL CHECK (knockout_round > 0),
  player_a_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  player_b_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status match_status NOT NULL DEFAULT 'SCHEDULED',
  court_number INT NOT NULL CHECK (court_number > 0),
  scheduled_time TIMESTAMP WITH TIME ZONE NOT NULL,
  estimated_start_time TIMESTAMP WITH TIME ZONE NOT NULL,
  umpire_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  linesman_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  winner_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  CONSTRAINT check_distinct_players CHECK (player_a_id <> player_b_id),
  CONSTRAINT check_winner_is_participant CHECK (winner_id = player_a_id OR winner_id = player_b_id OR winner_id IS NULL)
);

-- Match Games Table
CREATE TABLE public.match_games (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  game_number INT NOT NULL CHECK (game_number > 0),
  player_a_score INT NOT NULL CHECK (player_a_score >= 0),
  player_b_score INT NOT NULL CHECK (player_b_score >= 0),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Match Events Table
CREATE TABLE public.match_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  event_type VARCHAR(50) NOT NULL,
  event_time TIMESTAMP WITH TIME ZONE NOT NULL,
  player_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  card disciplinary_card,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Row Level Security (RLS) Policies
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Profiles: Allow users to select their own profile" ON public.profiles
  FOR SELECT USING (auth.uid() = id);

ALTER TABLE public.tournaments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tournaments: Allow all users to select" ON public.tournaments
  FOR SELECT USING (true);

ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Categories: Allow all users to select" ON public.categories
  FOR SELECT USING (true);

ALTER TABLE public.registrations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Registrations: Allow users to manage their own registrations" ON public.registrations
  FOR ALL USING (player_id = auth.uid());

ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Groups: Allow all users to select" ON public.groups
  FOR SELECT USING (true);

ALTER TABLE public.group_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Group Members: Allow all users to select" ON public.group_members
  FOR SELECT USING (true);

ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Matches: Allow all users to select" ON public.matches
  FOR SELECT USING (true);

ALTER TABLE public.match_games ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Match Games: Allow all users to select" ON public.match_games
  FOR SELECT USING (true);

ALTER TABLE public.match_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Match Events: Allow all users to select" ON public.match_events
  FOR SELECT USING (true);