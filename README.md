# UMPSAce Badminton

Badminton Club Full Flow Tournament Project

A Next.js + Supabase operations web app for UMPSA badminton tournaments. It supports singles and consent-based doubles entries, tournament squad eligibility, seeded draws, court scheduling, official duties, scoring, knockout progression, completion, archival, and published rankings.

Everyone uses one institutional login. Players can apply as AJK for a specific tournament from Home or its detail page. MT and System Admins review these requests at `/mt`, a focused dashboard with approvals and basic tournament management. Approved AJKs display `(AJK)` before their name and can receive duties for that tournament. Organization-wide appointments still require System Admin approval at `/admin/users`. Umpire/linesman are match-scoped duties recorded alongside global and tournament roles in `user_roles`. See [tournament AJK approvals](docs/tournament-ajk.md) for the role model and advisor/backup manager setup.

MT and administrators can open both **MT Dashboard** (`/mt`) and **Tournament management** (`/admin`) directly from Home and the side menu. MT/EXCO/admin accounts no longer see lower-role application forms. The confirmed backup manager is `prodenzel992@gmail.com`; its verified Auth account receives management bypass after applying the latest restoration migration. See [management access](docs/management-access.md).

## Requirements

- Node.js 22+
- A Supabase project with email/password authentication
- Supabase CLI for applying the checked-in migrations

## Local setup

1. Copy `.env.local` values into a local environment file:

   ```env
   NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your-publishable-or-anon-key
   ```

2. Install dependencies:

   ```bash
   npm ci
   ```

3. Apply the database migrations in order through the Supabase Dashboard or CLI:

   ```bash
   supabase login
   supabase link --project-ref YOUR_PROJECT_REF
   supabase db push
   ```

   The sixteen ordered workflow migrations are:
   - `supabase/migrations/20260924090154_committee_workflow_hardening.sql`
   - `supabase/migrations/20260924092650_live_match_operations.sql`
   - `supabase/migrations/20260925093000_terminal_and_seed_guards.sql`
   - `supabase/migrations/20260925094500_preview_seed_integrity.sql`
   - `supabase/migrations/20260925101500_publication_privacy.sql`
   - `supabase/migrations/20260925103000_registration_lock_order.sql`
   - `supabase/migrations/20260925104500_tournament_category_visibility.sql`
   - `supabase/migrations/20260926120000_knockout_bracket.sql`
   - `supabase/migrations/20261105085640_doubles_pairing_and_squad_rules.sql`
   - `supabase/migrations/20261105093718_league_standings.sql`
   - `supabase/migrations/20261106184015_organizational_role_approvals.sql`
   - `supabase/migrations/20261108162756_tournament_ajk_applications.sql`
   - `supabase/migrations/20261108164632_dynamic_draws_and_byes.sql`
   - `supabase/migrations/20261108172058_realtime_match_scores.sql`
   - `supabase/migrations/20261108180005_restore_management_access.sql`
   - `supabase/migrations/20261108184625_match_official_availability.sql`

   The final migrations add terminal-tournament write guards, confirmed-only seed enforcement, zero-match preview protection, validated category creation, preview metadata validation, publication-aware read policies, category-first registration/seed locking, and private draft/pre-publication tournament metadata.

4. Start the app:

   ```bash
   npm run dev
   ```

## Local full-flow test personas

For development only, set `TEST_AUTH_MODE=true` and `NEXT_PUBLIC_TEST_AUTH_MODE=true` in the ignored `.env.local`, then provide server-only credentials using these keys:

- `TEST_ADMIN_EMAIL` / `TEST_ADMIN_PASSWORD`
- `TEST_PLAYER01_EMAIL` / `TEST_PLAYER01_PASSWORD`
- `TEST_PLAYER02_EMAIL` / `TEST_PLAYER02_PASSWORD`
- `TEST_PLAYER03_EMAIL` / `TEST_PLAYER03_PASSWORD`
- `TEST_PLAYER04_EMAIL` / `TEST_PLAYER04_PASSWORD`
- `TEST_UMPIRE_EMAIL` / `TEST_UMPIRE_PASSWORD`
- `TEST_LINESMAN_EMAIL` / `TEST_LINESMAN_PASSWORD`

The legacy Umpire/Linesman persona buttons are now MT/EXCO. Prefer `TEST_MT_EMAIL`/`TEST_MT_PASSWORD` and `TEST_EXCO_EMAIL`/`TEST_EXCO_PASSWORD`; existing `TEST_UMPIRE_*` and `TEST_LINESMAN_*` values remain compatible. An optional AJK test account uses `TEST_AJK_EMAIL`/`TEST_AJK_PASSWORD`. These labels do not grant privileges. The organizational migration queues the existing MT/EXCO development identities for administrator review.

When enabled outside production, the login page shows persona buttons. Each button performs a real Supabase password sign-in; it does not bypass Auth, RLS, RPCs, or server authorization. Keep these variables out of source control and remove them after testing.

The full-flow fixture and walkthrough are documented in [`docs/full-flow-test.md`](docs/full-flow-test.md).

For doubles, create a doubles category in the committee workspace and set the tournament's main-squad roster before registration closes. A player invites a partner by exact institutional email; the partner accepts from the tournament page. Each pair occupies one capacity slot and may contain at most one main-squad player. Either partner can withdraw the pair while registration remains open. See [`docs/doubles-pairing.md`](docs/doubles-pairing.md).

## Roles

- **Player**: registers for open categories, views published draws, matches, standings, and rankings.
- **Club member / official candidate**: can be selected for umpire or linesman assignments after an administrator grants official-roster status.
- **Committee administrator**: an explicitly approved profile with `profiles.is_admin = true`. Committee membership alone does not grant administrator access.
- **Assigned umpire**: can access only the scoring console for matches assigned to them.

## Useful commands

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run check
```

The automated suite covers authentication helpers, workspace access, draws, scheduling, scoring and brackets. PGlite tests replay every checked-in migration in an isolated PostgreSQL database and exercise pairing consent, main-squad restrictions, grants/RLS, capacity, four-athlete scheduling, draw publication, scoring, knockout advancement and ranking publication. These tests do not connect to or modify the hosted Supabase project. They stub the Auth identity function and complement a hosted multi-user rehearsal; they do not replace one.

Draws now use final confirmed entries rather than requiring capacity or a preset group count. Category creation offers round-robin groups (with a target entries-per-group setting) and direct single elimination. Odd round-robin groups rotate rest rounds; elimination fields expand to the next power of two with randomly assigned byes. Doubles count pairs, and byes award no match/ranking points. See [dynamic draws](docs/dynamic-draws.md) for examples and installation.

The global **Draw / Schedule** menu opens `/matches` with only the signed-in player's unfinished fixtures, including either partner in doubles. Cards show opponents, tournament/category, Malaysia-time schedules or updated estimates, court and venue. Live matches appear first; postponed matches await a new schedule. Players with no upcoming fixtures see a friendly empty state. Existing results and group standings are available at `/matches?view=results`. The page refreshes automatically; no additional database migration is needed for this view.

Umpire point controls and the published **Group Preview** now synchronize through database-owned Realtime Broadcast. Each +1/-1 is saved immediately through a version-checked, idempotent RPC; viewer score cards update locally without a page refresh. Disconnects pause scoring with a Reconnecting toast until the saved score is synchronized. Apply the realtime scoring migration to activate it. See [realtime scoring](docs/realtime-scoring.md) for setup, access rules and verification.

## Important product-rule boundary

The tournament directory now loads from the server and includes every event visible under RLS, sorted newest first. Managers can see newly created drafts, and players can follow published, registered and completed events. It refreshes automatically and no longer drops an event from the list when its status leaves Registration Open.

If the app displays “Database setup is incomplete,” the hosted database is missing a newer workflow migration. Existing singles entry and match reads support the older schema using the signed-in user's normal RLS permissions; the app will not downgrade doubles records or bypass a permission error. Doubles options remain unavailable until the doubles migration is installed, and league standings display a setup message until the league migration is installed. Apply the listed migrations in order through the project owner's Supabase SQL Editor, then refresh the app.

The Leaderboard at `/rankings` lists everyone who has entered a tournament, including accepted doubles partners, before any points are published. Its league table shows played, wins, losses, games won, rally points for/against, net points, participation credits, win percentage, recent form and total points. Points follow `3 × match wins + games won + participation credits` and are committed only at tournament completion. The league migration backfills previously published results and implements the documented net-points → wins → win-percentage → latest head-to-head tie-break cascade. Unresolved ties share a position; entry alone awards no points.

Knockout crossover construction follows [`docs/knockout-bracket.md`](docs/knockout-bracket.md), using power-of-two fields of at least eight entries and reviewed publication. Byes, unresolved group qualification ties and individual doubles service rotation still need further rules or implementation. The approved doubles pairing scope supersedes the older singles-only statements in the original roadmap.
