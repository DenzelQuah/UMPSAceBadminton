# UMPSA Tournament Quality Assurance & Testing Specification

**Document Version:** 1.0  
**Related Documents:** `product-requirement.md`, `user-flows.md`, `seeding-algorithm.md`, `scheduling-system.md`, `security-rules.md`  
**Governance Standard:** ISO/IEC 25010 Software Quality Standard + UMPSA IT Security Guidelines

---

## 1. Executive Summary

This document specifies the authoritative Quality Assurance (QA) strategy and automated testing requirements for **UMPSAce Badminton**. To guarantee algorithmic correctness, secure role-based isolation, low-latency score propagation, and flawless E2E tournament workflows, the platform mandates a tiered testing hierarchy consisting of Unit, Integration, Security, and E2E Browser Automation suites.

---

## 2. Testing Technology Stack & Frameworks

The platform enforces a standardized, modern testing stack to cover both fast-feedback local runs and comprehensive continuous integration (CI) environments.

```
                   [ Automated Testing Stack ]
                                │
         ┌──────────────────────┼──────────────────────┐
         ▼                      ▼                      ▼
  [ Algorithmic Unit ]   [ Integration & Security ]  [ E2E Browser Flow ]
  - Vitest / Jest        - Vitest / Supabase Local   - Playwright
  - Sub-millisecond Execution - DB RLS Mock Assertions   - Headless Chrome/Firefox
```

### 2.1 Algorithmic & Unit Testing
* **Framework:** **Vitest** (configured with standard Jest compatibility layer).
* **Execution Boundary:** Enforced as local node execution with zero database dependencies.
* **Objective:** Fast, sub-millisecond validation of mathematical algorithms, seeding, tiebreaking, and time scheduling logic.

### 2.2 Security & Integration Testing
* **Framework:** **Vitest** with **Supabase CLI Local Emulator**.
* **Execution Boundary:** Runs local PostgreSQL containers. Test cases construct authenticated mock clients to assert database schemas, trigger operations, and evaluate Row-Level Security (RLS) constraints.

### 2.3 E2E Browser Automation
* **Framework:** **Playwright**.
* **Execution Boundary:** Runs headless Chromium, Firefox, and WebKit instances against local dev or staging builds to validate complete multi-user interaction journeys.

---

## 3. Unit Testing (The Math & Algorithm Suite)

The league standings PostgreSQL regression suite must also verify the zero-point entrant directory (including both doubles partners), publication gating, exact RP/statistics for 21/30 formats, walkovers and retirement, accumulation and archival, idempotent completion, rollback on failure, migration backfill, the complete ranking tie-break cascade and rejection of anonymous reads or player writes. `tests/league-standings.test.ts` runs against isolated PGlite PostgreSQL with checked-in migrations and simulated Auth identity, without connecting to hosted Supabase.

These tests isolate the core logic engines from external network or database IO, validating mathematical invariants.

### 3.1 Seeding & Draw Engine
* **Snake-Seeding Distribution:** Assert that a set of 8 seeded players are correctly distributed across 8 groups in an ascending/descending layout (e.g., Seed 1 $\rightarrow$ Group A, Seed 2 $\rightarrow$ Group B, ..., Seed 8 $\rightarrow$ Group H).
* **Fisher-Yates Randomization Bias:** Test that the unseeded player shuffling routine displays a uniform random distribution. The test shuffles an array of 1,000 items 10,000 times, asserting that the distribution coefficient of variation is within $\pm 5\%$ of ideal uniformity.
* **Uneven Group Remainder Math:** Assert that when total registered players are not perfectly divisible by the group count (e.g., 34 players, 8 groups), the system balances the remainder fairly (e.g., 6 groups of 4 players, 2 groups of 5 players), rejecting any distribution where group sizes differ by more than 1 competitor.

### 3.2 BWF Standings & Tiebreakers
* **Round-Robin Point Aggregation:** Assert that standings metrics ($W/L, PW/PL, NP, Pts$) aggregate correctly after recording game-set results.
* **Circular 3-Way Tie Stress-Test:** Simulate a three-player round-robin group tie where:
  * Player A beats Player B (2-0).
  * Player B beats Player C (2-1).
  * Player C beats Player A (2-1).
  * *Assertion:* Verify that the tie-breaking pipeline correctly falls back through **Standings Points $\rightarrow$ Net Sets $\rightarrow$ Net Rally Points** automatically to resolve and order the group standings without manual Operator intervention.

### 3.3 CSP Scheduling Engine
* **Simultaneous Player Booking Block:** Input a mock pool where Player A is scheduled to play on Court 1 at 10:00 AM. Assert that the CSP engine throws a conflict violation when attempting to schedule Player A on Court 2 at 10:20 AM.
* **20-Minute Rest Guardrail Enforcement:** Input a match sequence where Player A completes a match on Court 1 ending at 10:30 AM. Assert that the scheduling generator blocks any attempts to schedule Player A's next match prior to 10:50 AM.

---

## 4. Integration & Row-Level Security (RLS) Testing

Integration tests run against the local Supabase instance to verify database-level security boundaries.

### 4.1 Auth & Domain Guards
* **Verification Test:** Assert that `supabase.auth.signUp()` rejects registrations originating from `@gmail.com`, `@yahoo.com`, or other non-university external consumer domains.
* **Assertion:** The signup endpoint throws an HTTP `400 Bad Request` or Postgres domain check constraint violation.

### 4.2 Umpire Score Lock
* **Verification Test:** Initialize a match with `umpire_id = Umpire-Ali-UUID` and status `IN_PROGRESS`. Create a mock client authenticated as `User-Ahmad-UUID` (who is not the assigned Umpire). Attempt to call `updateGameScore()` or execute a database insert to `match_games`.
* **Assertion:** The database transaction is rejected, throwing a PostgreSQL `403 Forbidden` Row-Level Security (RLS) error.

### 4.3 State Immutability
* **Verification Test:** Assert that once a match status shifts to `COMPLETED`, further update attempts on `match_games` or `matches` by `Umpire-Ali-UUID` are rejected.
* **Navigation Assertion:** After the result is submitted, the assigned official must retain the `/umpire` workspace link and the terminal match must remain listed so the read-only scoring console can be reopened.
* **Administrator Navigation Assertion:** A committee administrator must retain a global Scoring console link and be able to reopen any published match after leaving an operator session.
* **Assertion:** Supabase returns an RLS violation.
* **Bypass Assertion:** Verify that if the request context carries a whitelisted Admin operator header (`is_admin = TRUE`), the update is successful and generates a row in `audit_logs`.

### 4.4 Draw Preview Privacy and Integrity
* **Verification Test:** Create a `DRAW_GENERATED` category with a private preview and assert that an authenticated non-committee player cannot read the preview or unpublished groups/matches.
* **Metadata Assertion:** Submit a preview whose player seed or private display name differs from the confirmed registration/profile and verify the database rejects the write.
* **Publication Assertion:** After explicit publication, verify the same player can read the published groups, matches, games, and events, while an administrator can continue to review the preview record.
* **Metadata Assertion:** Verify draft/pre-publication tournament and category metadata is hidden from an ordinary player, while open, published, completed, and own-registration records remain accessible.

### 4.5 Terminal and Seed Guards
* **Verification Test:** Mark a tournament `COMPLETED` or `ARCHIVED` and attempt category, registration, preview, group, match, game, and event writes; every write must be rejected.
* **Seed Assertion:** Seeds can exist only on confirmed registrations, and withdrawal clears the seed value.
* **Zero-Match Assertion:** A `READY` or `PUBLISHED` preview with zero generated matches is rejected until the singleton-group/bye rule is approved.

---

## 5. E2E User Journey Test Cases

Playwright scripts automate browser actions across multiple concurrently authenticated browser sessions to simulate real-time live events.

### 5.1 E2E Journey 1: Organizer Draw Lifecycle
1. **Login:** Playwright logs into the dashboard as `admin@umpsa.edu.my`.
2. **Setup:** Navigate to `/admin/tournaments` and click **Create Tournament**. Configures court limits to 4, scoring to `STANDARD_3X21`, and opens registration.
3. **Registration Mock:** Execute seed script registering 32 student competitors.
4. **Close Registration:** Tap **Close Registration**. Category status transitions to `REGISTRATION_CLOSED`.
5. **Seeding:** Tag the top 8 players as Seed 1 through Seed 8.
6. **Trigger Draw:** Tap **Start Automated Draw**. Verify that the Draw Preview screen displays correct snake and random groups.
7. **Publish:** Tap **Publish Draw**. Verify that category transitions to `DRAW_PUBLISHED`, generating group standings tables and match schedules.

### 5.2 E2E Journey 2: Umpire Live Courtside Scoring Flow
1. **Dual Session Launch:** Playwright opens two side-by-side browser sessions:
   * **Session A (Umpire Ali):** Authenticated as the assigned match Umpire.
   * **Session B (Spectator Abu):** Authenticated player viewing the public scoreboard.
2. **Start Match:** Session A taps **Start Match** on Court 1. Verify Session B's screen renders the active court state as `IN_PROGRESS`.
3. **Score Tracking:** Session A taps **+1 Player A** multiple times.
4. **WebSocket Sync Assertion:** Verify that Session B's scoreboard updates in real-time within 500ms of each tap.
5. **Deuce Extension Check:** Simulate a score progression reaching **20-20**:
   * Verify that the UI displays a "Deuce" indicator.
   * Increment Player A to 21. Assert the game does not terminate.
   * Increment Player A to 22 (score 22-20). Verify the game terminates, automatically prompting Session A with the Game 1 summary.
6. **Hard Cap Check:** Simulate Game 2 reaching **29-29**:
   * Verify UI displays a "Sudden Death" warning.
   * Increment Player B to 30 (score 30-29). Assert Player B wins Game 2 immediately.
7. **Interval Check:** Progress the deciding Game 3 score to **11 points** for Player A:
   * Assert a full-screen **60-second countdown timer** automatically covers the scoring screen, and point increment buttons are disabled.
8. **Final Submit:** Complete the match. Session A clicks **Digital Sign-off & Submit**.
   * Assert the Umpire screen shifts to read-only.
   * Verify the public leaderboard automatically recalculates group standings on Session B's dashboard.
