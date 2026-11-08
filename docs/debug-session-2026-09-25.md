# Debug and verification session — 25 September 2026

## Scope

This session re-ran the local quality gates, exercised the unauthenticated browser boundary, checked the production build surface, reviewed the Supabase migration security shape, and corrected stale Next.js cache invalidation after committee actions.

This session also completed one disposable authenticated administrator rehearsal and applied follow-up database integrity hardening migrations. The rehearsal generated a private preview but did not publish an official draw. All temporary tournament, category, registration, audit, profile, and Auth user records were removed afterward; final remote counts returned to the pre-rehearsal state.

## Automated verification

| Check | Result |
|---|---|
| `npm run check` | Passed: ESLint, TypeScript, 39 tests across 6 files, and production build |
| `npm run test:coverage` | Passed: 39 tests; 94.65% statements, 90.04% branches, 100% functions, and 99.03% lines across the pure modules |
| `npm audit --audit-level=low` | Passed: 0 vulnerabilities |
| `npm ci --dry-run` | Passed: lockfile/manifest resolution is synchronized |
| Supabase CLI version | 2.109.1 |
| `supabase db lint --local` | Blocked: no local PostgreSQL connection |
| `supabase migration list --local` | Blocked: no local PostgreSQL connection |
| `supabase projects list` | Blocked: CLI access token is not configured; no token was requested or exposed |

## Browser and route-boundary checks

The development server and a separate production server (`next start -p 3001`) both returned the login surface successfully.

Unauthenticated route checks redirected to login while preserving the intended local destination:

- `/admin` → `/login?redirect_to=%2Fadmin`
- `/umpire` → `/login?redirect_to=%2Fumpire`
- `/umpire/court/<known-match-id>` → login with the court path preserved
- `/tournaments` → login with `/tournaments` preserved
- `/rankings` → login with `/rankings` preserved
- `/admin/users` → login with `/admin/users` preserved

The consumer-domain login test was rejected with the expected institutional-domain message. Lighthouse returned 100 for Accessibility, Best Practices, and SEO on both the development and production login surfaces. The production browser console had no application errors.

## Supabase boundary checks without an authenticated session

Using only the configured publishable key, anonymous requests were rejected as intended:

- `tournaments`, `categories`, and `category_draw_previews` reads returned PostgreSQL `42501` permission errors.
- The administrator draw RPC returned `42501 permission denied for function save_category_draw_preview` when called with valid parameter names.
- Static migration review found 24 public `SECURITY DEFINER` functions across the ordered workflow migrations; every parsed function has an explicit `auth.uid()` or committee authorization check.
- Static review found no anonymous `GRANT EXECUTE`, deprecated `auth.role()` policy, broad lifecycle-table `GRANT ALL`, anonymous policy pattern, or direct authenticated category insert grant.

These checks do not replace an authenticated admin/player rehearsal.

## Authenticated administrator rehearsal

A disposable administrator profile was created through Supabase Auth, elevated only for the rehearsal, and used against the real Next.js administrator workspace.

The rehearsal completed these steps:

1. Created a disposable tournament draft through the committee UI.
2. Added a two-group singles category through the UI.
3. Opened registration.
4. Added four disposable confirmed fixture registrations using existing mock player profiles.
5. Assigned seeds 1 and 2 through the roster UI.
6. Closed registration after the two-group threshold was met.
7. Generated a private draw preview.
8. Regenerated the preview and confirmed the coverage remained valid.
9. Opened the publication confirmation dialog and chose **Keep preview**.
10. Reloaded the nested tournament page and confirmed the private preview remained visible.

Verified draw facts:

- 4 confirmed players
- 2 balanced groups
- Seeds placed in separate groups
- 2 staged round-robin matches
- Preview status: `READY`
- Published groups: 0
- Published matches: 0
- Tournament/category status: `DRAW_GENERATED`

The staging tournament, category, registrations, preview, audit rows, administrator profile, and Auth user were then deleted. Final verification returned to 19 profiles, 2 tournaments, 3 categories, 4 groups, 24 matches, 0 games, and 0 events. `registrations`, `categories`, and `category_draw_previews` remained RLS-enabled.

## Applied integrity hardening

The ordered integrity migrations `supabase/migrations/20260925093000_terminal_and_seed_guards.sql` and `supabase/migrations/20260925094500_preview_seed_integrity.sql` were syntax-tested in rollback transactions and applied through the authenticated Supabase SQL Editor. They add:

- Database validation for category name, capacity/group/qualifier relationships, and the 64-group UI boundary.
- A validated `create_tournament_category` RPC; direct authenticated category `INSERT` is revoked and the category action now calls the RPC.
- Parent-tournament terminal guards for categories, registrations, previews, groups, matches, games, and events.
- Confirmed-registration-only seed enforcement with automatic seed clearing on withdrawal.
- A positive-match-count constraint for `READY`/`PUBLISHED` previews, preventing a zero-match publication until the unresolved singleton-group/bye rule is decided.
- Preview player/seed/display metadata validation against confirmed registrations and profiles.
- `P0002` not-found mapping in the tournament and category server actions.

The follow-up `supabase/migrations/20260925094500_preview_seed_integrity.sql`, `supabase/migrations/20260925101500_publication_privacy.sql`, `supabase/migrations/20260925103000_registration_lock_order.sql`, and `supabase/migrations/20260925104500_tournament_category_visibility.sql` were also syntax-tested in rollback transactions and applied through the authenticated Supabase SQL Editor. Rollback-only tests confirmed that a valid preview is accepted, tampered seed numbers and private display names are rejected, and a published preview may retain a later profile display-name change. Authenticated-player RLS tests confirmed that unpublished groups, members, matches, games, and events return no rows while published rows remain visible; an administrator claim retains full visibility. Draft tournaments/categories were hidden from ordinary players, open/published records remained visible, and a player with an active registration could still see their generated category metadata. The revised seed RPC completed successfully under an authenticated administrator claim with category-first locking. Final remote verification shows 19 profiles, 2 tournaments, 3 categories, 0 previews, 4 groups, 24 matches, 0 games, and 0 events; RLS remains enabled on profiles, tournaments, categories, registrations, previews, groups, group members, matches, games, and events; publication-aware and tournament/category visibility policies are active; direct authenticated category insert is denied; and no `Codex` test rows remain.

## Defect fixed

Committee server actions previously called `revalidatePath("/admin")` or used a category ID as if it were a tournament ID. That could leave nested pages such as `/admin/tournaments/[tournamentId]` stale after a draw, schedule, completion, or archival action.

Updated actions now invalidate the admin layout after these mutations:

- `app/actions/tournaments.ts`
- `app/actions/categories.ts`
- `app/actions/matches.ts`

The existing tournament-specific invalidations remain in place where the tournament ID is already available. The production build and full check pass after the fix.

## Follow-up audit findings

A read-only workflow audit identified additional issues. The following items were addressed in the integrity migration and admin-client pass:

- Terminal (`COMPLETED`/`ARCHIVED`) tournaments now have database-level parent-status guards and read-only UI treatment.
- Category creation now uses a validated database RPC; direct authenticated category inserts are revoked.
- Published previews remain reviewable after publication.
- Category switching is disabled while an async mutation is in flight, and stale category responses are ignored.
- Removed incompatible profile-table fallbacks that requested columns not granted to authenticated clients; committee profile data now fails explicitly through the protected RPC path instead of silently using an invalid query.
- Seeds are restricted to confirmed registrations and cleared on withdrawal.
- Zero-match `READY`/`PUBLISHED` previews are rejected until the unresolved singleton-group/bye rule is decided.
- Registration/seed operations now lock the category before the registration row; broader cross-operation lock-order normalization remains queued.
- Draft/pre-publication tournament and category metadata is now hidden from ordinary players while open, published, completed, and own-registration records remain accessible.

Still queued for a separate controlled slice:

- Standardizing lock ordering across registration, seed, draw, and completion operations.
- Resolving the unresolved three-or-more-player tie, knockout crossover, and Black Card rules.

These findings are recorded for prioritization; the rehearsal itself did not publish or retain test data.

## Remaining blocked work

1. The app browser is currently logged out after the disposable rehearsal; another authenticated administrator session is required only for additional UI testing. Do not send credentials in chat.
2. The Supabase CLI is not linked because no CLI access token is configured. Linking requires the user to authenticate the CLI locally; no access token should be pasted into this conversation.
3. Docker/local PostgreSQL is unavailable, so Supabase lint, pgTAP, and local RLS suites remain pending.
4. A persistent approved administrator, assigned umpire, and player account are still needed for the moderated multi-user rehearsal listed in the completion report.
5. Broader cross-operation lock-order normalization and unresolved product-rule decisions remain queued for a separate controlled slice.

## Next safe test sequence

1. Sign in as the approved administrator when a persistent test account is available.
2. Select a staging category with at least one confirmed player per group, or create a disposable rehearsal category.
3. Close registration, assign seeds, and start the automated draw.
4. Verify private preview coverage, seed distribution, and group balance.
5. Leave the preview unpublished until explicitly approved.
6. Re-run the remote Security Advisor when the Dashboard session is available; do not publish or archive a live event as part of verification.
