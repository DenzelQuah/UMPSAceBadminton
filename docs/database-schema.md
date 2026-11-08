# UMPSA Tournament Database Schema Specification

## Restored management access - 9 November 2026

See `docs/management-access.md`. Normalize approved database role/user_role/organizational_role fields through the shared helper; MT and Admin retain /mt and full /admin management. Hide lower-role application widgets and skip their reads for MT, EXCO and admins. The owner confirmed prodenzel992@gmail.com as backup: only the exact verified Auth email grants bypass after the restoration migration, never profile email/user_metadata. Keep normal EXCO/player management restrictions.

## Live scoring - 9 November 2026

See `docs/realtime-scoring.md`. Per-point writes use `adjust_match_point` with an immutable operation UUID and expected snapshot version, followed by database-owned private category Broadcast. Do not replace this with absolute-score overwrites, client-originated broadcasts or per-point page refreshes. Umpire controls lock on disconnect and reopen only after authoritative catch-up; an uncertain point retries the same UUID. Group Preview updates only affected score cards.

## Dynamic draws - 9 November 2026

See `docs/dynamic-draws.md`. Draws count final CONFIRMED entries (one doubles pair is one entry), derive group counts from target group size, and support direct elimination. Elimination pads to the next power of two with random explicit byes; byes are never scored matches or ranking wins. Round-robin odd fields rotate rests. The database validates roster coverage and source links at save/publish. This supersedes old fixed group count, minimum-eight and power-of-two-only restrictions.

## Tournament AJK extension ? 9 November 2026

See `docs/tournament-ajk.md`. Global organization appointments still require System Admin review, but MT and System Admins approve **tournament-specific** AJK applications at `/mt`. `roles`/`user_roles` distinguish global appointments, tournament AJK grants and match duties. Home shows `(AJK)` from approved server role state. Advisor backup access requires an exact, verified Auth email configured in the migration; never infer it from profile/user metadata. The MT Dashboard contains only AJK approvals and basic tournament management. This extension supersedes older blanket statements that MT cannot approve AJK.

## Approved extension — 5 November 2026

**Organization extension, 7 November 2026:** `profiles.organizational_role` is a constrained text field (`PLAYER`, `MT`, `EXCO`, `AJK`) defaulting to `PLAYER`; `organizational_role_detail` stores the approved position/team. `organization_role_requests` stores user, requested role/detail, `PENDING/APPROVED/REJECTED/CANCELLED` status, reviewer, review note and timestamps, with at most one pending request per user. RLS exposes a request only to its owner or a platform administrator. All writes use authenticated RPCs. `current_actor_profile` returns only the caller's approved role; signup metadata can create a pending request, never an approved role. Platform-admin checks remain distinct from the admin-or-MT tournament-manager helper. Approval/revocation and membership changes are audited atomically. Legacy profile RPC signatures remain available for compatibility.

League standings use the existing active `global_rankings` accumulator, with stored `games_won`, `points_won`, `points_lost` and `participations` integer counters (all nonnegative). Tournament completion updates every counter and ranking points in the same transaction. A migration backfills these counters from already published tournament records. `get_league_standings()` includes every profile appearing in a registration (including doubles partners) or an existing published ranking, with zero counters until results are published. It returns W/L, game wins, rally points for/against, NP, win percentage and the last five published results. No season cutoff is guessed; the existing active accumulator remains in use until the separately specified season archive/reset workflow is implemented.

The user approved doubles registration and one account with workspace choices. This section supersedes the earlier singles-only boundary for doubles pairing.

- `categories.participation_format`: `SINGLES` (existing default) or `DOUBLES`. Capacity, groups, seeds and qualifiers count entries: individual players or accepted pairs.
- `registrations.partner_id`: nullable profile reference. In doubles, `player_id` is the pair's representative and `partner_id` is the consenting partner. Both identities belong to the same entry; existing groups, match sides and winners reference the representative. Pair membership freezes when registration closes.
- `doubles_invitations`: category, inviter, partner, status, creation time. Only the recipient accepts or declines; the sender can cancel. Acceptance atomically creates one capacity-controlled registration. Pending invitations consume no capacity. Either partner may withdraw the pair before registration closes.
- `tournament_squad_members`: tournament/profile membership managed by approved administrators, independent of administrator and official permissions. A pair may contain zero or one main-squad player, never two. Both invitation and acceptance validate this in the database. Squad changes cannot invalidate an existing pair and freeze when registration closes.
- Authenticated users read their own invitations; administrators can review them. Squad membership is visible to authenticated tournament viewers. Direct writes are revoked; authorized RPCs and constrained internal triggers perform mutations.
- Scheduling and self-officiating guards consider all four doubles athletes. Team display names include both players; ranking publication awards each partner the entry's earned points.

**Document Version:** 1.0  
**Related Documents:** `product-requirement.md`, `user-roles.md`, `user-flows.md`, `match-rules.md`, `ranking-system.md`, `scheduling-system.md`  
**Governance Standard:** PostgreSQL 15+ / Supabase Relational Database Standard

---

## 1. Executive Summary

This document specifies the authoritative database architecture for **UMPSAce Badminton**. The system is built on **PostgreSQL** within the **Supabase** platform. It utilizes strict data integrity constraints, foreign key mappings, customized enumeration types, database performance indexing, and robust **Row-Level Security (RLS)** policies to enforce multi-role isolation, score immutability, and administrative oversight.

---

## 2. PostgreSQL Custom ENUM Types

Custom ENUM types enforce domain-level data integrity for state transitions and rule sets across the application.

```sql
-- Tournament Lifecycle Statuses
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

-- Match Lifecycle Statuses
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

-- Registration Statuses
CREATE TYPE registration_status AS ENUM (
  'CONFIRMED',
  'WAITLISTED',
  'WITHDRAWN'
);

-- Supported Scoring Formats
CREATE TYPE scoring_format AS ENUM (
  'STANDARD_3X21',
  'SINGLE_SET_1X30'
);

-- Disciplinary Cards
CREATE TYPE disciplinary_card AS ENUM (
  'YELLOW',
  'RED',
  'BLACK'
);
```

---

## 3. Core Tables & Foreign Key Mappings

### 3.1 User Profiles Table
Extends the core Supabase `auth.users` metadata.
```sql
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name VARCHAR(255) NOT NULL,
  matric_number VARCHAR(50) UNIQUE,
  email VARCHAR(255) NOT NULL UNIQUE,
  is_admin BOOLEAN NOT NULL DEFAULT FALSE, -- Elevated Organizer privilege flag
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  
  -- Institutional Domain Restriction Check
  CONSTRAINT check_umpsa_email CHECK (
    email LIKE '%@adab.umpsa.edu.my' OR 
    email LIKE '%@umpsa.edu.my'
  )
);
```

### 3.2 Tournaments & Categories Tables
Defines physical court limits and rule configurations.
```sql
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

CREATE TABLE public.categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL, -- e.g., "Men's Singles"
  max_capacity INT NOT NULL CHECK (max_capacity > 0),
  group_count INT NOT NULL CHECK (group_count > 0),
  qualifiers_per_group INT NOT NULL DEFAULT 1 CHECK (qualifiers_per_group > 0),
  format scoring_format NOT NULL DEFAULT 'STANDARD_3X21',
  status tournament_status NOT NULL DEFAULT 'DRAFT',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  
  CONSTRAINT unique_tournament_category UNIQUE (tournament_id, name)
);
```

### 3.3 Registrations Table
Manages waitlist ordering and seed assignments.
```sql
CREATE TABLE public.registrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status registration_status NOT NULL DEFAULT 'CONFIRMED',
  seed_number INT DEFAULT NULL CHECK (seed_number > 0), -- Seed assignment tags (e.g., 1 for Seed 1)
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  
  CONSTRAINT unique_player_category_reg UNIQUE (category_id, player_id),
  CONSTRAINT unique_seed_per_category UNIQUE (category_id, seed_number)
);
```

### 3.4 Groups & Standings Tables
Tracks round-robin rankings metrics directly in the database.
```sql
CREATE TABLE public.groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  name VARCHAR(50) NOT NULL, -- e.g., "Group A"
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  
  CONSTRAINT unique_group_name UNIQUE (category_id, name)
);

CREATE TABLE public.group_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  
  -- Round-Robin Standings Metrics (Atomic Aggregators)
  matches_played INT NOT NULL DEFAULT 0 CHECK (matches_played >= 0),
  matches_won INT NOT NULL DEFAULT 0 CHECK (matches_won >= 0),
  matches_lost INT NOT NULL DEFAULT 0 CHECK (matches_lost >= 0),
  points_won INT NOT NULL DEFAULT 0 CHECK (points_won >= 0),   -- Total rally points scored
  points_lost INT NOT NULL DEFAULT 0 CHECK (points_lost >= 0),  -- Total rally points conceded
  net_points INT NOT NULL DEFAULT 0,                           -- Calculated: points_won - points_lost
  standings_points INT NOT NULL DEFAULT 0 CHECK (standings_points >= 0), -- +2 pts per Match Win, +0 per Loss
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  
  CONSTRAINT unique_player_per_group UNIQUE (group_id, player_id)
);
```

### 3.5 Matches, Match Games & Match Events Tables
Maps courts, umpires, game scores, and cards.
```sql
CREATE TABLE public.matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  group_id UUID REFERENCES public.groups(id) ON DELETE SET NULL, -- NULL for knockout matches
  knockout_round INT DEFAULT NULL CHECK (knockout_round > 0),    -- e.g., 16 = Round of 16, 4 = Semis
  
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

CREATE TABLE public.match_games (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  game_number INT NOT NULL CHECK (game_number BETWEEN 1 AND 3),
  player_a_score INT NOT NULL DEFAULT 0 CHECK (player_a_score >= 0),
  player_b_score INT NOT NULL DEFAULT 0 CHECK (player_b_score >= 0),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  
  CONSTRAINT unique_game_per_match UNIQUE (match_id, game_number)
);

CREATE TABLE public.match_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  player_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE, -- Player penalized or event owner
  card disciplinary_card DEFAULT NULL,
  notes TEXT,
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);
```

### 3.6 Rankings Tables
Stores cumulative points based on the Premier League point accumulator standard.
```sql
CREATE TABLE public.global_rankings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  ranking_points INT NOT NULL DEFAULT 0 CHECK (ranking_points >= 0),
  cumulative_net_points INT NOT NULL DEFAULT 0,
  total_matches_won INT NOT NULL DEFAULT 0 CHECK (total_matches_won >= 0),
  total_matches_played INT NOT NULL DEFAULT 0 CHECK (total_matches_played >= 0),
  win_percentage NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE public.historical_rankings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  academic_year_semester VARCHAR(50) NOT NULL, -- e.g., "2026/2027-SEM1"
  ranking_points INT NOT NULL,
  cumulative_net_points INT NOT NULL,
  rank INT NOT NULL CHECK (rank > 0),
  archived_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  
  CONSTRAINT unique_historical_rank UNIQUE (player_id, academic_year_semester)
);
```

### 3.7 Notification Logs & Audit Trails Tables
Ensures system observability and referee accountability.
```sql
CREATE TABLE public.notification_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  type VARCHAR(100) NOT NULL,
  channel VARCHAR(20) NOT NULL CHECK (channel IN ('IN_APP', 'EMAIL', 'BOTH')),
  title VARCHAR(255) NOT NULL,
  body TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  delivery_status VARCHAR(20) NOT NULL CHECK (delivery_status IN ('PENDING', 'SENT', 'FAILED')),
  read_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT, -- Admin or Referee account
  action VARCHAR(255) NOT NULL,                                              -- e.g., "REFEREE_OVERRIDE_SCORE"
  target_table VARCHAR(100) NOT NULL,                                        -- e.g., "match_games"
  target_id UUID NOT NULL,                                                   -- ID of mutated record
  original_data JSONB NOT NULL,
  new_data JSONB NOT NULL,
  reason TEXT NOT NULL,                                                      -- Mandatory justification
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);
```

---

## 4. Performance Indexes

Database queries must be fast and secure. The following indexes are optimized for scheduling lookups, standing updates, and leaderboard calculations.

```sql
-- Speed up category searches based on active status
CREATE INDEX idx_categories_status ON public.categories (status);

-- Scheduling: Speed up player and court conflict verification checks
CREATE INDEX idx_matches_scheduling ON public.matches (scheduled_time, court_number, status);
CREATE INDEX idx_matches_player_a ON public.matches (player_a_id);
CREATE INDEX idx_matches_player_b ON public.matches (player_b_id);

-- Speed up standings lookups within specific groups
CREATE INDEX idx_group_members_standings ON public.group_members (group_id, standings_points DESC, net_points DESC);

-- Speed up leaderboard sorting of active player rankings
CREATE INDEX idx_global_rankings_leaderboard ON public.global_rankings (ranking_points DESC, cumulative_net_points DESC);
```

---

## 5. Row-Level Security (RLS) Policies

All tables are protected by default. Access must go through explicit security definitions.

```sql
-- Enable Row-Level Security globally across tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournaments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_games ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.global_rankings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.historical_rankings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
```

### 5.1 Shared Auxiliary Functions
Helper functions to safely check administrator/organizer credentials server-side without recursion.
```sql
CREATE OR REPLACE FUNCTION public.is_admin(user_id UUID)
RETURNS BOOLEAN SECURITY DEFINER AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = user_id AND is_admin = TRUE
  );
END;
$$ LANGUAGE plpgsql;
```

---

### 5.2 Table Specific Policy Definitions

#### Profiles Policy
* **Select:** Authenticated campus users can view other profiles.
* **Update:** Users can only modify their own profiles (cannot alter `is_admin` independently).
* **Insert/All:** Whitelisted Admins can manage all records.
```sql
CREATE POLICY select_profiles ON public.profiles 
  FOR SELECT TO authenticated USING (TRUE);

CREATE POLICY update_own_profile ON public.profiles 
  FOR UPDATE TO authenticated USING (auth.uid() = id);

CREATE POLICY admin_all_profiles ON public.profiles 
  FOR ALL TO authenticated USING (public.is_admin(auth.uid()));
```

#### Read-Only Public Views Policies (Standings, Draws, Schedules, Live Scores)
Allows any verified campus user to read schedule data, match scores, brackets, and leaderboards.
```sql
CREATE POLICY public_read_tournaments ON public.tournaments FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY public_read_categories ON public.categories FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY public_read_registrations ON public.registrations FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY public_read_groups ON public.groups FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY public_read_group_members ON public.group_members FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY public_read_matches ON public.matches FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY public_read_match_games ON public.match_games FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY public_read_match_events ON public.match_events FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY public_read_global_rankings ON public.global_rankings FOR SELECT TO authenticated USING (TRUE);
```

#### Seed Selection, Draw Generation & Admin Override (Organizer-Only Write)
Restricts all major settings modifications, brackets creation, and score overrides strictly to Whitelisted Organizer Accounts.
```sql
CREATE POLICY admin_write_tournaments ON public.tournaments FOR ALL TO authenticated USING (public.is_admin(auth.uid()));
CREATE POLICY admin_write_categories ON public.categories FOR ALL TO authenticated USING (public.is_admin(auth.uid()));
CREATE POLICY admin_write_registrations ON public.registrations FOR ALL TO authenticated USING (public.is_admin(auth.uid()));
CREATE POLICY admin_write_groups ON public.groups FOR ALL TO authenticated USING (public.is_admin(auth.uid()));
CREATE POLICY admin_write_group_members ON public.group_members FOR ALL TO authenticated USING (public.is_admin(auth.uid()));
CREATE POLICY admin_write_match_events ON public.match_events FOR ALL TO authenticated USING (public.is_admin(auth.uid()));
CREATE POLICY admin_write_audit_logs ON public.audit_logs FOR ALL TO authenticated USING (public.is_admin(auth.uid()));
```

---

### 5.3 The Umpire Live Score Lock Policies

These critical policies ensure that an assigned Umpire can enter, correct, and track score points during active games, but blocks mutations as soon as a match completes.

#### Matches Update Policy
Allows the assigned Umpire to start a match and complete it, but locks edits once the status updates to `COMPLETED`.
```sql
CREATE POLICY umpire_update_matches ON public.matches
  FOR UPDATE TO authenticated
  USING (
    auth.uid() = umpire_id 
    AND status = 'READY'
  )
  WITH CHECK (
    auth.uid() = umpire_id 
    AND status IN ('IN_PROGRESS', 'COMPLETED', 'POSTPONED', 'READY')
  );

CREATE POLICY admin_force_matches ON public.matches
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()));
```

#### Match Games Mutation Policy
Allows the assigned Umpire to insert/update point sets only while the match state is actively marked as `IN_PROGRESS`.
```sql
-- Insert game scores
CREATE POLICY umpire_insert_match_games ON public.match_games
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.matches
      WHERE id = match_games.match_id 
      AND umpire_id = auth.uid() 
      AND status = 'IN_PROGRESS'
    )
  );

-- Update game scores
CREATE POLICY umpire_update_match_games ON public.match_games
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.matches
      WHERE id = match_games.match_id 
      AND umpire_id = auth.uid() 
      AND status = 'IN_PROGRESS'
    )
  );

-- Overrides allowed only for Whitelisted Admins
CREATE POLICY admin_force_match_games ON public.match_games
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()));
```
