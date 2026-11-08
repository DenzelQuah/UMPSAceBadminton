# UMPSA Tournament API & Backend Communication Specification

## Restored management access - 9 November 2026

See `docs/management-access.md`. Normalize approved database role/user_role/organizational_role fields through the shared helper; MT and Admin retain /mt and full /admin management. Hide lower-role application widgets and skip their reads for MT, EXCO and admins. The owner confirmed prodenzel992@gmail.com as backup: only the exact verified Auth email grants bypass after the restoration migration, never profile email/user_metadata. Keep normal EXCO/player management restrictions.

## Live scoring - 9 November 2026

See `docs/realtime-scoring.md`. Per-point writes use `adjust_match_point` with an immutable operation UUID and expected snapshot version, followed by database-owned private category Broadcast. Do not replace this with absolute-score overwrites, client-originated broadcasts or per-point page refreshes. Umpire controls lock on disconnect and reopen only after authoritative catch-up; an uncertain point retries the same UUID. Group Preview updates only affected score cards.

## Personal draw and schedule — 9 November 2026

`getUpcomingPlayerMatches()` takes no player ID. It derives identity from the authenticated session and queries the four singles/doubles participant columns with an OR filter, combined with unfinished match states (SCHEDULED, READY, IN_PROGRESS, POSTPONED). Parent category/tournament context supplies names and venue. Completed/archived events are excluded from the upcoming list. Existing RLS remains in force, and a schema fallback is allowed only when a probe proves the database is singles-only.

`/matches` is the global **Draw / Schedule** destination. It defaults to upcoming fixtures and refreshes periodically. Times use Asia/Kuala_Lumpur, with updated estimates labeled explicitly; postponed fixtures do not show obsolete times or court assignments. `/matches?view=results` preserves completed results and group standings through the existing authenticated reads. Doubles opponents and win/loss outcomes are determined by the player's side, including either partner. Query errors display an error state rather than claiming the player has no upcoming matches.

## Dynamic draws - 9 November 2026

See `docs/dynamic-draws.md`. Draws count final CONFIRMED entries (one doubles pair is one entry), derive group counts from target group size, and support direct elimination. Elimination pads to the next power of two with random explicit byes; byes are never scored matches or ranking wins. Round-robin odd fields rotate rests. The database validates roster coverage and source links at save/publish. This supersedes old fixed group count, minimum-eight and power-of-two-only restrictions.

## Tournament AJK extension ? 9 November 2026

See `docs/tournament-ajk.md`. Global organization appointments still require System Admin review, but MT and System Admins approve **tournament-specific** AJK applications at `/mt`. `roles`/`user_roles` distinguish global appointments, tournament AJK grants and match duties. Home shows `(AJK)` from approved server role state. Advisor backup access requires an exact, verified Auth email configured in the migration; never infer it from profile/user metadata. The MT Dashboard contains only AJK approvals and basic tournament management. This extension supersedes older blanket statements that MT cannot approve AJK.

## Approved doubles and workspace extension — 5 November 2026

**Organization model, 7 November 2026:** registration optionally accepts `requestedRole` and `roleDetail` as a pending request only. `submitRoleRequest`, `getMyRoleRequests`, `getOrganizationApprovals`, `reviewRoleRequest`, and `revokeOrganizationRole` implement the application flow. Approval/revocation requires platform-administrator authority; MT cannot approve. `getVisibleTournaments` returns all RLS-visible events in creation order rather than filtering the directory to Registration Open. The manager guard accepts approved MT and administrators; match guards require an approved assigned staff member or manager.

**Game type selector, 7 November 2026:** `createCategory` accepts a `gameType` preset (`MEN_SINGLES`, `MEN_DOUBLES`, `WOMEN_DOUBLES`, `WOMEN_SINGLES`, `MIXED_DOUBLES`). The server derives the canonical category name and singles/doubles entry format, preventing mismatched labels and team sizes. `THREE_V_THREE` is visible as a future option but cannot be created or registered until its rules are defined. Existing category records retain their names. Category labels do not infer gender from names or grant eligibility beyond the existing registration rules.

- `getGlobalRankings()` now reads `get_league_standings()`: one row per historical tournament entrant with published match/game/rally statistics, participation credits, fixed-precision win percentage, shared ranking positions and the last five published outcomes. The original `get_global_rankings()` RPC remains compatible and uses the same ordering. These are authenticated read operations; all scoring and ranking calculations stay in PostgreSQL.

- `getPairState(categoryId)` reads the signed-in player's pending invitation, entry status and pair display name.
- `inviteDoublesPartner(categoryId, partnerEmail)` creates a pending invitation without reserving capacity.
- `respondDoublesInvitation(id, ACCEPT | DECLINE | CANCEL)` enforces actor ownership; acceptance atomically checks eligibility and capacity and registers the pair.
- `getTournamentSquad(tournamentId)` and `setTournamentSquadMember(tournamentId, profileId, enabled)` are administrator-only operations. Roster writes are audited and cannot invalidate existing pairs.
- `createCategory` accepts `participationFormat: SINGLES | DOUBLES`. Existing callers default to singles. `get_tournament_entry_categories` includes the entry format while retaining the older category RPC for compatibility.
- `get_my_registrations` returns entries for either partner. `get_category_entries` returns authorized entry names and partner identity for matching, standings and draw displays.
- The login identity never chooses its own privilege level. The server computes workspace capabilities, including linesman assignments, and match operations retain their existing assignment checks.

**Document Version:** 1.0  
**Related Documents:** `product-requirement.md`, `user-flows.md`, `database-schema.md`, `match-rules.md`, `ranking-system.md`  
**Governance Standard:** Next.js App Router (Server Actions) + Supabase Realtime WebSockets Standard

---

## 1. Executive Summary

This document specifies the communication layer between the Next.js App Router frontend and the Supabase PostgreSQL database. All write mutations are modeled as typed **Next.js Server Actions** executing on secure server boundaries with validation guards. Real-time updates—such as live scoring updates, bracket progressions, and personalized schedule alerts—are pushed to client dashboards using event-driven **Supabase Realtime WebSocket Channels**.

---

## 2. Next.js Server Actions (Database Mutations)

All mutations are implemented as TypeScript asynchronous functions marked with the `"use server"` directive. They enforce server-side validation, authentication, and error checking prior to database commit.

### 2.1 Auth & Identity

#### `loginWithDomain()`
Authenticates users via Supabase Auth and validates institutional domains.
* **Arguments:**
  ```typescript
  interface LoginCredentials {
    email: string;
    password?: string; // Optional if using Google OAuth
    provider: 'email' | 'google';
  }
  ```
* **Server-Side Validation:**
  - Verifies that the email matches the required institutional regex:
    - Student: `^[a-zA-Z0-9._%+-]+@adab\.umpsa\.edu\.my$`
    - Staff / Admin: `^[a-zA-Z0-9._%+-]+@umpsa\.edu\.my$`
* **Behavior:**
  - If validation fails, throws a `403 Forbidden` error immediately, rejecting auth tokens.
  - If validation passes, triggers Supabase auth login and redirects to `/dashboard`.

---

### 2.2 Category Registration

#### `registerForCategory()`
Registers a competitor for a tournament category or places them on the waitlist.
* **Arguments:**
  ```typescript
  interface RegisterPayload {
    categoryId: string;
    playerId: string;
  }
  ```
* **Server-Side Validation:**
  - **Check 1 (Auth Guard):** Verifies `auth.uid() === playerId` or `is_admin(auth.uid())`.
  - **Check 2 (Status Guard):** Verifies the category is marked `REGISTRATION_OPEN`.
  - **Check 3 (Duplicate Check):** Verifies that the player is not already registered in this category.
* **Behavior (Atomic Transaction):**
  - Query category current capacity and current confirmed count.
  - **Outcome A (Under Capacity):** Inserts registration into `registrations` with status `CONFIRMED`.
  - **Outcome B (At Capacity):** Inserts registration into `registrations` with status `WAITLISTED`.

---

### 2.3 Automated Draw Engine

#### `triggerAutomatedDraw()`
Executes the fair seed distribution (snake-seeding) and Fisher-Yates randomization for group allocations.
* **Arguments:**
  ```typescript
  interface DrawPayload {
    categoryId: string;
    groupCount: number;
  }
  ```
* **Server-Side Validation:**
  - Verifies `is_admin(auth.uid())` is `true`.
  - Verifies that the category status is `REGISTRATION_CLOSED`.
* **Behavior (Algorithm Sandbox):**
  - Runs the snake-seeding distribution algorithm for players with assigned seed tags.
  - Runs the Fisher-Yates shuffle algorithm on unseeded players to allocate them to remaining slots.
  - Saves the structured group layout in a temporary JSON state within the `category_draw_previews` table for Organizer review (does not publish yet).

#### `publishDraw()`
Finalizes the temporary preview, locks the group compositions, and generates matches.
* **Arguments:**
  ```typescript
  interface PublishPayload {
    categoryId: string;
  }
  ```
* **Server-Side Validation:**
  - Verifies `is_admin(auth.uid())` is `true`.
  - Verifies that a draw preview exists and the category is in `DRAW_PREPARATION` or `DRAW_GENERATED` status.
* **Behavior (Atomic Transaction):**
  1. Creates physical `groups` and inserts player relations into `group_members` (initializing all score statistics to 0).
  2. Generates round-robin group match fixtures automatically and inserts them into `matches`.
  3. Transitions category status to `DRAW_PUBLISHED`.
  4. Triggers automatic notification alerts to all registered category players.

---

### 2.4 Umpire Live Scoring

These Server Actions must satisfy strict Row-Level Security (RLS) constraints.

#### `updateGameScore()`
Increments or decrements a player's score during active play.
* **Arguments:**
  ```typescript
  interface ScorePayload {
    matchId: string;
    gameNumber: number; // 1, 2, or 3
    playerAScore: number;
    playerBScore: number;
  }
  ```
* **Server-Side Validation:**
  - **Auth Guard:** Verifies `auth.uid() === umpire_id` for this specific match.
  - **Status Guard:** Verifies that the match status is `IN_PROGRESS`.
* **Behavior:** Updates `match_games` with the raw score, triggering a Supabase Realtime WebSocket broadcast.

#### `logDisciplinaryCard()`
Logs warning and fault cards issued by the Umpire.
* **Arguments:**
  ```typescript
  interface CardPayload {
    matchId: string;
    playerId: string;
    cardType: 'YELLOW' | 'RED' | 'BLACK';
    notes?: string;
  }
  ```
* **Server-Side Validation:**
  - Verifies `auth.uid() === umpire_id` and the match is `IN_PROGRESS`.
* **Behavior (Atomic Transaction):**
  - Inserts the card log event into `match_events`.
  - **Red Card Penalty:** If the card is `RED`, automatically increments the opponent's active set score by `+1` point in `match_games`.

#### `submitMatchResult()`
Finalizes a completed match, locking scores and updating standings.
* **Arguments:**
  ```typescript
  interface SubmitPayload {
    matchId: string;
    winnerId: string;
  }
  ```
* **Server-Side Validation:**
  - Verifies `auth.uid() === umpire_id` and the match status is `IN_PROGRESS`.
* **Behavior (Atomic Transaction):**
  1. Sets `winner_id` and transitions match status to `COMPLETED` in `matches` table.
  2. Permanently revokes the Umpire's update permission.
  3. Recalculates round-robin group members' metrics: increments Matches Played, Won/Lost counts, Points Won/Lost, Net Points, and Standings Points (`+2` points for match win).

---

### 2.5 Organizer Overrides

#### `executeRefereeOverride()`
Allows an authorized Organizer to alter a finalized score or match status.
* **Arguments:**
  ```typescript
  interface OverridePayload {
    matchId: string;
    newStatus: 'COMPLETED' | 'WALKOVER' | 'RETIRED' | 'CANCELLED';
    newWinnerId?: string;
    customGameScores?: { gameNumber: number; playerAScore: number; playerBScore: number; }[];
    reason: string; // Mandatory justification
  }
  ```
* **Server-Side Validation:**
  - Verifies `is_admin(auth.uid())` is `true`.
* **Behavior (Atomic Transaction with Audit Logging):**
  1. Fetches current match state and caches it as `original_data`.
  2. Commits updates to `matches` and `match_games`.
  3. Recalculates the affected `group_members` standings metrics.
  4. Inserts an audit snapshot record into `audit_logs` capturing operator, original state, updated state, and the mandatory text reason.

---

## 3. Supabase Realtime WebSocket Channels

Clients subscribe to lightweight WebSocket broadcast streams to receive instant UI updates without polling the server.

```
 [ Supabase Realtime Engine ]
              │
              ├──► Channel: "court-live-[match_id]"
              │    (Point increments, timer count-downs, cards)
              │
              ├──► Channel: "tournament-standings-[category_id]"
              │    (Standings table updates, knockout bracket advancements)
              │
              └──► Channel: "user-alerts-[profile_id]"
                   (15-minute court calls, schedule shifts)
```

### 3.1 Live Court Scoreboard Channel
* **Subscription Name:** `court-live-[match_id]`
* **Stream Events:**
  - `SCORE_UPDATE`: Pushes updated integer scores and active server details.
    ```json
    { "event": "SCORE_UPDATE", "player_a_score": 14, "player_b_score": 11, "serving": "player_a" }
    ```
  - `INTERVAL_TIMER`: Launches a countdown timer screen on client devices.
    ```json
    { "event": "INTERVAL_TIMER", "duration_seconds": 60, "active": true }
    ```
  - `DISCIPLINARY_ACTION`: Renders card overlays on screens.
    ```json
    { "event": "DISCIPLINARY_ACTION", "player_id": "UUID", "card": "RED" }
    ```

### 3.2 Standings & Brackets Channel
* **Subscription Name:** `tournament-standings-[category_id]`
* **Stream Events:**
  - `STANDINGS_UPDATE`: Signals stands widgets to fetch fresh standings tables.
    ```json
    { "event": "STANDINGS_UPDATE", "group_id": "UUID" }
    ```
  - `BRACKET_ADVANCEMENT`: Animates players moving to the next bracket node.
    ```json
    { "event": "BRACKET_ADVANCEMENT", "match_id": "UUID", "winner_id": "UUID" }
    ```

### 3.3 Personal Court Calls Channel
* **Subscription Name:** `user-alerts-[profile_id]`
* **Stream Events:**
  - `COURT_CALL`: Displays full-screen overlay prompting check-in.
    ```json
    { "event": "COURT_CALL", "match_id": "UUID", "court": 3, "message": "Match #14: Proceed to Court 3" }
    ```
  - `SCHEDULE_SHIFT`: Displays alert indicating their match was pulled forward or delayed.
    ```json
    { "event": "SCHEDULE_SHIFT", "match_id": "UUID", "new_time": "10:15 AM" }
    ```

---

## 4. Standardized Error Handling

API operations reject invalid requests using structured JSON payloads mimicking HTTP statuses:

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "status": 400,
    "message": "Human-readable error explanation",
    "details": {}
  }
}
```

### 4.1 Error Definitions

* **`403 FORBIDDEN` (Not Assigned Umpire / Domain Reject)**
  * **Trigger:** An unauthorized user attempts to register with a non-UMPSA email domain, or an Umpire tries to update a score for a court to which they are not assigned.
  * **Payload:**
    ```json
    {
      "success": false,
      "error": {
        "code": "AUTH_FORBIDDEN",
        "status": 403,
        "message": "Access denied. You are not the assigned Umpire for this match fixture."
      }
    }
    ```

* **`409 CONFLICT` (Double-Booking / Scheduling Violations)**
  * **Trigger:** An Organizer attempts to assign an official to officiate a match that overlaps with a playing schedule, breaching the scheduling CSP rules.
  * **Payload:**
    ```json
    {
      "success": false,
      "error": {
        "code": "SCHEDULE_CONFLICT",
        "status": 409,
        "message": "Scheduling conflict detected.",
        "details": { "conflicting_user_id": "UUID", "reason": "User is playing on Court 1 at 10:30 AM." }
      }
    }
    ```

* **`422 UNPROCESSABLE ENTITY` (Invalid State Transition / Locked Scores)**
  * **Trigger:** An Umpire tries to submit a point adjustment to a match that has been finalized, or an Organizer tries to generate a draw before registration is closed.
  * **Payload:**
    ```json
    {
      "success": false,
      "error": {
        "code": "INVALID_STATE_TRANSITION",
        "status": 422,
        "message": "Match score cannot be modified because the match status is already COMPLETED."
      }
    }
    ```
