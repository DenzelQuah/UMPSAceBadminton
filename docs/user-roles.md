# UMPSAce Badminton - User Roles & Permissions Specification

## Restored management access - 9 November 2026

See `docs/management-access.md`. Normalize approved database role/user_role/organizational_role fields through the shared helper; MT and Admin retain /mt and full /admin management. Hide lower-role application widgets and skip their reads for MT, EXCO and admins. The owner confirmed prodenzel992@gmail.com as backup: only the exact verified Auth email grants bypass after the restoration migration, never profile email/user_metadata. Keep normal EXCO/player management restrictions.

## Tournament AJK extension ? 9 November 2026

See `docs/tournament-ajk.md`. Global organization appointments still require System Admin review, but MT and System Admins approve **tournament-specific** AJK applications at `/mt`. `roles`/`user_roles` distinguish global appointments, tournament AJK grants and match duties. Home shows `(AJK)` from approved server role state. Advisor backup access requires an exact, verified Auth email configured in the migration; never infer it from profile/user metadata. The MT Dashboard contains only AJK approvals and basic tournament management. This extension supersedes older blanket statements that MT cannot approve AJK.

## Approved organization model — 7 November 2026

The user approved this model, superseding earlier administrator-only tournament management and separate umpire/linesman account labels:

- **Administrator:** approves/rejects/revokes MT, EXCO and AJK organizational access. This remains the existing separately approved `is_admin` privilege; account registration cannot request or grant it.
- **MT (Majlis Tertinggi):** approved leadership such as President, Vice President, Secretary or Treasurer. MT can manage tournaments and assign match duties to approved EXCO/AJK members, but cannot approve organizational access or grant administrator privileges.
- **EXCO:** approved Technical, Logistics, Multimedia, Public Relations or other teams. Match duties (umpire/linesman) are assigned by MT/administrators, not chosen as permanent account roles.
- **AJK:** approved part-time committee members, eligible for assigned match duties.
- Everyone registers normally and may request an organizational role and position/team. Requests are pending until an administrator reviews them; pending/rejected requests grant no organizational permissions. Existing accounts can request from their dashboard.
- An approved committee member can also compete. Self-officiating and scheduling safeguards still apply. Revoked members lose scoring authority immediately even if an old match assignment remains.
- Existing explicitly approved official-roster members migrate to EXCO with a legacy-roster label to preserve their existing assignment capabilities. Development accounts formerly named umpire/linesman become MT/EXCO test actors and enter the approval queue; their labels do not grant approval.

**Approved clarification, 5 November 2026:** Everyone uses one institutional login. `/dashboard` presents authorized Player, Official and Administration workspaces. Workspace selection grants no privileges. Approved administrators retain all workspaces; official-roster membership or an umpire/linesman assignment reveals Official duties. Only the assigned umpire or an administrator can score a match; linesmen see read-only assignments. Main-squad membership is tournament-specific, managed by administrators and unrelated to account privileges.

**Document Version:** 1.0  
**Related Documents:** `product-requirement.md`, `user-flows.md`, `security-rules.md`

---

## 1. Executive Summary & Role Model Architecture

UMPSAce Badminton operates on a **Contextual Role-Based Access Control (RBAC)** architecture. Unlike traditional systems that force users to register separate accounts for different functions, UMPSAce decouples a user's **Platform Identity** from their **Contextual Capabilities**.

A single authenticated user account can seamlessly transition between participating as a competitor, judging a line courtside, and umpiring a live tournament match depending on their active assignment.

### The Three-Tier Identity Layer
1. **Platform-Level Identity:** The global user account authenticated via Supabase Auth (Email/Password or Google OAuth), bound to UMPSA institutional domain policies.
2. **Tournament-Level Role:** The contextual capability granted to an identity within a specific tournament (e.g., Registered Competitor in *Men's Singles*, or Member of the *Officials Roster*).
3. **Match-Level Assignment:** The time-bound operational duty assigned to an official for a specific physical court and match fixture (e.g., *Match #14 - Court 2 - Primary Umpire*).

---

## 2. Core Persona Definitions & Permissions

### 2.1 Player (Student / Competitor)
The default capability granted to any authenticated user registering for a tournament category.

* **Domain Restriction:** Must authenticate using an authorized student domain (`@adab.umpsa.edu.my`).
* **Capabilities & Permissions:**
  - Browse active tournaments and view public draw brackets.
  - Register for tournament categories (subject to capacity and waitlist guardrails).
  - View personalized match schedules, assigned court numbers, and estimated start times.
  - View group round-robin standings tables and calculated Net Points (NP).
  - Submit post-tournament feedback and report code-of-conduct issues.
* **Explicit Restrictions:**
  - Cannot modify match scores, timers, or bracket placements.
  - Cannot access organizer administrative dashboards.
  - Cannot officiate any match in which they are an active participant.

### 2.2 Organizer (Tournament Administrator)
The elevated administrative authority responsible for governance, setup, and execution of the tournament lifecycle.

* **Domain & Authorization Restriction (Developer Whitelist):** While student committee members authenticate using the standard campus domain (`@adab.umpsa.edu.my`), domain authentication alone does NOT grant administrative access. A user is only granted the `ORGANIZER` capability if their specific email address is explicitly granted access by the System Developer (via an environment variable whitelist or direct database `is_admin = true` boolean elevation).
* **Capabilities & Permissions:**
  - Create, modify, and archive tournaments and distinct categories (Singles, Doubles).
  - Configure tournament rules, scoring formats (21-pt vs 30-pt), and physical court allocations.
  - Manage player registrations, promote waitlisted players, and assign Seed tags (`Seed 1`, `Seed 2`).
  - Trigger the automated round-robin draw generation and publish official brackets.
  - Populate the "Officials Roster Pool" and assign users to specific court slots.
  - **Referee Override Mode:** Force-edit locked match results, override interval timers, revoke disciplinary cards, or trigger walkover/retirement statuses during disputes.
  - Advance tournament phases from group stage round-robin to single-elimination knockout stages.

---

### 2.3 Official (Unified Umpire & Linesman Pool)
A specialized capability assigned by an Organizer to standard user accounts for court management. 

#### A. Umpire Mode (Match Controller)
When assigned as the primary Umpire for a specific match fixture:
* **Capabilities & Permissions:**
  - Access the mobile-optimized Live Scoring Interface for the assigned court.
  - Start match timers, increment/decrement scores, and trigger mandatory 11-pt / 15-pt intervals.
  - Log disciplinary actions (Yellow Cards, Red Cards) with timestamped interruption notes.
  - Execute digital sign-off to finalize match results, permanently locking the score and triggering automated group standings recalculations.
* **Explicit Restrictions:**
  - Cannot modify the tournament draw, player registrations, or global tournament settings.
  - Cannot modify match scores after executing the digital completion sign-off.

#### B. Linesman Mode (Court Assistant)
When assigned as a visual line judge for a specific match fixture:
* **Capabilities & Permissions:**
  - View assigned court, match fixture details, scheduled time, and primary Umpire identity.
  - Execute digital "Check-In" to notify court readiness to the Umpire and Organizer.
* **Explicit Restrictions:**
  - Cannot increment match scores, manage interval timers, or submit match completions.

---

## 3. Multi-Role Context Switching & Conflict Guardrails

Because UMPSAce consolidates roles into a single account, the system enforces automated scheduling guardrails to prevent operational conflicts.

### 3.1 The Multi-Role Matrix
| Platform Identity | Tournament A (Campus Open) | Tournament B (Inter-Faculty) | Match #12 (Court 1) | Match #18 (Court 3) |
| :--- | :--- | :--- | :--- | :--- |
| **User: Ali** | Player (Men's Singles) | Official Roster Pool | Competitor (Playing) | Primary Umpire |
| **User: Siti** | Player (Women's Singles)| Official Roster Pool | Linesman | Competitor (Playing) |

### Match official assignment — 9 November 2026

Approved MT and EXCO members, System Admins, and the verified backup manager can open **Assign officials** on a specific published fixture in Group Preview or the knockout bracket. MT/Admin can also open it from tournament management. `/matches/[matchId]/officials` shows only that match's assignment controls; EXCO gains no tournament creation, scheduling, or role-approval permission.

The roster includes approved global MT/EXCO/AJK members, System Admins, and AJK members approved for that tournament. Pending applicants and AJK grants for other tournaments are excluded. Unavailable members remain visible with a reason. Availability checks include assignments across all tournaments, self-officiating (including doubles partners), overlapping 40-minute duty slots, and the existing 70-minute start-time buffer between playing and officiating. Cancelled/postponed fixtures do not block assignments. Unscheduled assignments are explicitly provisional and are checked again on scheduling.

Database writes recheck eligibility, availability and match state under the shared scheduling lock, then save `matches.umpire_id` / `matches.linesman_id` and an audit event atomically. Existing triggers update match duty roles and live score snapshots. Assignments lock once a match begins or a tournament/category closes. Roster fetching happens on opening the match panel or explicit refresh; no per-fixture polling is added to the live audience view. Apply `20261108184625_match_official_availability.sql` after the preceding migrations to activate these database entry points.

### 3.2 Automated Assignment Guardrails
The system scheduling engine must enforce the following validation rules before locking an official assignment:
1. **Concurrent Competitor Block:** An Organizer cannot assign User X as an Umpire or Linesman for any match that overlaps with User X's scheduled playing time as a competitor (enforcing a mandatory 30-minute buffer before and after their own match).
2. **Self-Officiating Block:** A user can never be assigned as an Official (Umpire or Linesman) for a match fixture where their own user profile is registered as Player A or Player B.
3. **Simultaneous Duty Block:** A user cannot be assigned to two distinct courts or matches during the exact same time slot.

---

## 4. Authorization & Security Boundaries

### 4.1 Server-Side RBAC Enforcement
Frontend UI toggles (e.g., hiding admin buttons) are insufficient for security. All role mutations and protected actions must be validated server-side via Supabase Row-Level Security (RLS) policies and Next.js API route guards.

* **Score Mutation Guard:** An incoming request to update a match score must verify that the requesting `user_id` matches the assigned `umpire_id` for that specific `match_id`, AND that the match status is currently `IN_PROGRESS`.
* **State Freeze:** Once a match status transitions to `COMPLETED`, RLS policies automatically revoke update permissions for the `umpire_id`. Only an identity bearing the `ORGANIZER` capability can mutate a completed record.
* **Domain Auth Guard:** Authentication endpoints must reject any registration or login attempt that does not match the configured institution domain regex during deployment.

---

## 5. Items Requiring Immediate Decision (`TODO: NEEDS DECISION`)

1. ~~**Staff vs. Student Organizer Permissions:**~~ *(RESOLVED)* All student committee members (`@adab.umpsa.edu.my`) require explicit, manual elevation by the developer via a hardcoded email whitelist or database flag to access Organizer privileges. Default student login only grants `PLAYER` capabilities.
2. **Official Roster Invitation Flow:** Does an Organizer add a user to the Officials Roster by searching their matric number/email, or do users apply to be officials via a self-service registration toggle on their profile?
3. **Disciplinary Card Thresholds:** When an Umpire logs a Red Card, does the system automatically award a point to the opponent, or does it merely log the infraction for Organizer review?
