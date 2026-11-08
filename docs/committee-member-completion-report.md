# Committee-member feature completion report

**Review date:** 25 September 2026  
**Scope:** Committee/administrator perspective first, with the minimum official scoring slice needed to operate a published draw.

The latest local and browser verification details are recorded in [`docs/debug-session-2026-09-25.md`](debug-session-2026-09-25.md).

## Executive summary

The committee workflow is now implemented as a staged, server-authoritative operations experience rather than a collection of loosely connected screens. The main flow is:

1. Create a tournament draft.
2. Add independent categories and scoring formats.
3. Open or close registration.
4. Review confirmed and waitlisted players.
5. Assign and validate seeds.
6. Generate a private draw preview.
7. Review, regenerate, cancel, or explicitly publish the draw.
8. Schedule matches with court, rest, and official conflict checks.
9. Assign eligible officials with self-officiating and overlap protection.
10. Start and score matches from the official console.
11. Submit a locked result or record a reasoned committee override.
12. Complete the tournament, publish protected rankings, and archive the event.

The webapp is materially easier and safer for committee members than the previous prototype. All seven ordered workflow migrations have now been applied to the connected Supabase project through the authenticated Dashboard SQL Editor, and the committee happy path has been smoke-tested with real authenticated sessions.

## Business value delivered

| Committee need | Implemented value |
|---|---|
| Reduce manual setup | Structured tournament/category forms and reusable staged workflow reduce hunting across screens. |
| Protect fair registration | Database-backed capacity, duplicate prevention, waitlist ordering, withdrawal, and promotion are atomic operations. |
| Make draws auditable | Seeds are validated, unseeded players are shuffled, a private preview is stored, and publication is explicit and transactional. |
| Prevent schedule conflicts | Court collisions, player double-booking, rest gaps, self-officiating, simultaneous duties, and player/official buffers are checked server-side. |
| Reduce match-day errors | Format-aware scoring controls, interval timers, disciplinary events, result sign-off, and result locking are implemented. |
| Preserve accountability | Protected audit records cover registration, seeds, draws, scheduling, officials, scores, overrides, completion, and archival. |
| Publish reliable records | Tournament completion processes protected ranking points and exposes a global leaderboard. |
| Reduce accidental access | Committee access is based only on `profiles.is_admin`; club membership is an official-roster attribute, not administrator access. |

## What changed

### Access and security

- Centralized server-side authentication and committee authorization in `lib/auth/authorization.ts`.
- Removed the temporary non-UMPSA authentication bypass.
- Added institutional domain validation on login and registration.
- Added safe local redirect validation for post-login navigation.
- Updated `proxy.ts` to use verified Supabase claims, protect all dashboard routes, and preserve refreshed cookies on redirects.
- Added a server-side admin layout guard.
- Removed the client-side `forceAdminAccess` bypass.
- Added a database profile provisioning trigger and protected profile RPCs.
- Added RLS grants/policies and security-definer RPCs for privileged operations.
- Normalized the connected project's drifted `tournaments.status` text column to the `tournament_status` enum with a `DRAFT` default.
- Removed legacy remote policies and broad lifecycle-table mutation grants; authenticated clients can create safe setup records but must use audited RPCs for status changes, scheduling, draws, and overrides.
- Corrected the atomic registration function's post-`SELECT FOUND` state bug and made score submission, overrides, red-card penalties, and group standings validate their invariants server-side.

### Committee operations

- Rebuilt the committee dashboard with operational metrics, tournament portfolio cards, recent protected activity, and a recommended next action.
- Added tournament draft creation with server-side validation.
- Added category creation with capacity, group, qualifier, and scoring-format validation.
- Added explicit registration open/close actions.
- Added confirmed/waitlisted roster visibility, waitlist promotion, withdrawal support, and inline seed editing.
- Replaced the old one-click draw with preview → regenerate/cancel → publish.
- Added atomic draw persistence and prevented fake default Court 1/current-time scheduling.
- Added manual scheduling with conflict feedback.
- Added explicit official assignment and save states.
- Added tournament completion, ranking publication, and archival actions.
- Corrected admin-layout cache invalidation after draw, schedule, completion, and archival mutations so nested tournament workspaces do not remain stale.
- Added terminal-tournament read-only guards across category, registration, draw, group, match, game, and event writes; category creation now uses a validated database RPC.
- Enforced confirmed-only seeds with automatic withdrawal cleanup and rejected zero-match private previews until the singleton-group/bye rule is approved.
- Validated private preview player, seed, and display metadata against confirmed registrations and profiles.
- Added publication-aware RLS so non-committee users cannot read unpublished groups, members, matches, games, or events; committee members retain full visibility.
- Hid draft/pre-publication tournament and category metadata from ordinary players while preserving open, published, completed, and own-registration access.
- Standardized registration/seed locking on the category row before the registration row.
- Removed invalid profile-table fallback queries that conflicted with the final column grants; protected profile RPCs are now the sole committee profile path.

### Match-day operations

- Added `/umpire` for assigned officials.
- Added `/umpire/court/[matchId]` with large touch targets, game tabs, format-aware scoring, intervals, discipline actions, sign-off, and read-only result state.
- Added server-enforced start, score, card, submit, and referee-override operations.
- Enforced valid 2–0/2–1 game sequences, format-aware winner checks, completed-game red-card protection, and synchronized group net points.
- Added admin override reason validation, ranking-publication protection, and audit logging.

### UI/UX and accessibility

- Replaced the generic organizer wording with a clear committee workspace.
- Added a visible five-stage workflow stepper.
- Added human-readable lifecycle labels instead of raw enum strings.
- Added responsive cards for mobile/tablet and scroll-safe tables for dense data.
- Added loading, error, and not-found recovery states.
- Added explicit close-registration readiness feedback (including the number of additional confirmed players needed per group) instead of a generic failure toast.
- Added skip navigation, semantic landmarks, labeled selects, keyboard-focusable category controls, and larger standard touch targets.
- Corrected the UMPSA gold foreground contrast and the self-referential font token.
- Added page metadata and removed the default “Create Next App” title.
- Added a published leaderboard rather than a placeholder rankings page.

## Efficiency and ease-of-use assessment

This is a design assessment, not a substitute for moderated usability testing with real committee members.

### Expected efficiency

- **Tournament setup:** one create action and one category dialog; the committee sees the current stage instead of inferring it from scattered status text.
- **Roster review:** confirmed, waitlisted, capacity, and seed state are visible together. Seed edits save from the roster row without opening a separate admin page.
- **Draw review:** preview is private and explicit. The committee can inspect every group and seed before taking the irreversible publish action.
- **Scheduling:** one scheduling dialog validates the whole allocation before persistence; rejected actions explain the conflict in human language.
- **Official assignment:** officials are loaded once, self-officiating choices are removed, and Save is explicit to prevent accidental changes.
- **Match day:** the official sees only assigned matches and large controls; result sign-off clearly communicates the lock.
- **Recovery:** refresh buttons, loading skeletons, route errors, and structured toasts preserve context after failures.

### Simplicity rating

- **Committee workspace navigation:** High — primary tasks are grouped by tournament and stage.
- **First-time setup:** High — the form explains what is safe to do next and does not expose database concepts.
- **Draw operation:** High — preview and publish are separate, reducing accidental disclosure.
- **Scheduling:** Medium-high — manual scheduling is safe, but a future drag-and-drop court grid can make large events faster.
- **Match scoring:** High for the implemented slice — large targets and format-aware rules reduce operator error.
- **Cross-event administration:** Medium — committee access is currently global by approved administrator profile, as specified by the existing product documents; per-tournament delegation is not yet defined.

## Debug and verification results

The following checks were run successfully on 25 September 2026:

| Check | Result |
|---|---|
| `npm ci` | Passed; lockfile and manifest are synchronized. |
| `npm audit --audit-level=low` | Passed; 0 vulnerabilities. |
| `npm run lint` | Passed with 0 errors and 0 warnings. |
| `npm run typecheck` | Passed. |
| `npm test` | Passed: 39 tests across 6 files. |
| `npm run test:coverage` | Passed: 39 tests; 94.65% statements, 90.04% branches, 100% functions, and 99.03% lines across the pure modules. |
| `npm run build` | Passed on Next.js 16.3.6; all routes compiled. |
| `npm run check` | Passed end-to-end. |
| SQL parser/rollback check | All seven ordered migration files parsed successfully; the five integrity migrations were also executed inside rollback-only transactions. |
| Remote migration application | All seven migrations applied successfully through the authenticated Supabase Dashboard SQL Editor. |
| Remote schema/RPC verification | Verified new tables, lifecycle enum/default, workflow RPCs, validated category RPC, RLS enablement, legacy-policy removal, terminal guards, seed guards, preview metadata guards, publication-aware child policies, tournament/category visibility policies, and privilege boundaries. |
| Authenticated committee E2E smoke test | Approved administrator signed in, opened the committee workspace, registered a test player, closed registration successfully, generated/cancelled a private draw preview, and loaded the official scoring console. |
| Role/RLS smoke test | Player account was redirected from `/admin` and an unassigned official court route; non-admin RPC attempts returned `42501`; direct lifecycle-table updates were denied. |
| Database transaction test | Start → score two games → submit result was executed and rolled back; winner, game count, audit writes, and net points were verified. Red-card penalty and valid override paths were also exercised in rollback transactions. |
| Browser route guard smoke test | `/`, `/admin`, `/umpire`, and an official court route redirect unauthenticated users to login with the intended local redirect. |
| Authenticated disposable administrator rehearsal | Created a temporary staging tournament/category, assigned four fixture players and two seeds, closed registration, generated and regenerated a private two-group draw preview, verified two staged matches with no published groups/matches, opened/kept the publication confirmation, and cleaned up all temporary records and the Auth user. |
| Integrity hardening rollback tests | Terminal category/group/match/preview writes, invalid category settings, ineligible seeds, and zero-match previews were rejected; withdrawal cleared seeds; the validated category RPC succeeded under an administrator claim. |
| Preview metadata rollback tests | Valid preview metadata was accepted; tampered seed numbers and private display names were rejected; published previews could retain later profile display-name changes. |
| Publication-aware RLS rollback tests | An authenticated non-committee player saw zero unpublished group/member/match/game/event rows while published rows remained visible; an administrator claim retained full visibility. |
| Tournament/category visibility rollback tests | Draft tournament/category rows were hidden from a player, open and own-registration generated categories remained visible, and administrator visibility was retained. |
| Registration lock-order rollback test | The revised seed RPC completed under an authenticated administrator claim with category-first locking; no fixture rows remained. |
| Browser domain validation smoke test | Consumer-domain login is rejected without a console error. |
| Browser Lighthouse smoke test | Accessibility 100, Best Practices 100, SEO 100 on the login surface. |
| Production server smoke test | `next start -p 3001` served the login surface successfully; unauthenticated admin, umpire, tournament, rankings, and official-court routes preserved safe local redirects. |
| Supabase Security Advisor | 0 errors after the final migration; 25 warnings remain, primarily the intentional authenticated SECURITY DEFINER RPC surface, which is authorized inside each function. |

## Important deployment/testing limitations

These are environment limitations, not silently treated as passes:

- The local machine has no Docker daemon, so `supabase db lint --local` and local pgTAP suites could not run.
- Supabase Security Advisor reports 0 errors and 25 warnings; the remaining warnings are the intentionally authenticated `SECURITY DEFINER` RPC surface and should be reviewed alongside the function-level authorization checks rather than removed blindly.
- Final remote verification confirms RLS on all lifecycle/read tables, five publication-aware child-read policies plus tournament/category visibility policies, no temporary `Codex` rows, and unchanged pre-rehearsal row counts.
- The Supabase project is not linked to the CLI, so migration history/diff tooling and `supabase db push --dry-run --linked` remain unavailable; the migrations were applied and verified through the authenticated Dashboard SQL Editor instead.
- The Supabase Dashboard session was available for this verification and was used without exposing any password or access token. A future session may still require re-authentication before further remote checks.
- The authenticated smoke test accounts were temporary and have been removed. A real committee should still run a moderated multi-user tournament rehearsal before production sign-off.
- The latest administrator rehearsal was disposable and fully cleaned. The follow-up terminal-tournament, direct-category-insert, seed-lifecycle, zero-match-publication, preview-metadata, publication-privacy, tournament/category visibility, profile-fallback, and registration/seed lock-order guards are now applied; async category-switch and published-preview review are addressed in the admin client, while broader cross-operation lock-order normalization and unresolved product-rule decisions remain follow-up work.
- The connected project contains pre-existing/mock tournament data; verify event-specific records before enabling completion, ranking publication, or archival for a live event.
- The product documents leave three-or-more-player tie resolution, knockout crossover rules, and some ranking/season archive rules unresolved. The implementation does not guess those rules.
- Realtime broadcasts and email notification delivery are not enabled in this slice. The official console has explicit refresh rather than pretending a live subscription exists.
- The match-status documents conflict on Black Card/DISQUALIFIED behavior. The current implementation records Black Card events and protects administrator confirmation, but it does not invent a contradictory terminal enum until the rule is approved.

## Required deployment checklist

1. ✅ Apply and verify all seven workflow migrations in the connected Supabase project.
2. ✅ Run the committee happy path with an approved administrator and a player account.
3. ✅ Run role/RLS smoke tests and rollback-only database transaction checks.
4. ☐ Link the project with `supabase link --project-ref ...` and run a migration diff against a disposable test database.
5. ☐ Run `supabase db lint --local` or the project’s RLS/pgTAP suite in an environment with Docker.
6. ☐ Rehearse with separate player, assigned-umpire, and approved-administrator accounts during a moderated tournament workflow.
7. ☐ Verify existing remote tournament/category data before enabling completion and ranking publication.

## Bottom line

The committee experience is now substantially more complete, safer, and easier to operate than the starting prototype. The checked-in migrations are applied to the connected Supabase project, the remote schema and privilege boundaries have been verified, and authenticated committee/player smoke tests passed. Production sign-off should still follow a Docker-backed RLS/pgTAP run and a moderated multi-user rehearsal on the event data that will be used.
