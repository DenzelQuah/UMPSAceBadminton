# UMPSAce Badminton - User Flows Specification

**Document Version:** 1.0  
**Related Documents:** `product-requirements.md`, `user-roles.md`, `tournament-rules.md`, `database-schema.md`

---

## 1. Overview

This document defines the step-by-step interactive flows for all user roles within UMPSAce Badminton. Each flow outlines the triggering event, user UI actions, system validation checks, database state changes, and expected outcomes.

### TBA match timing and MT scheduling — 9 November 2026

TBA means no time has been announced; it does not lock MT out of scheduling. MT/Admin sees **Set match time** on untimed fixtures in their personal Draw / Schedule view and the public group/knockout draw. The action selects the correct tournament category and opens that match's existing scheduling form directly. **Manage tournament schedules** opens the full management view, including matches the MT is not playing in.

Future knockout slots display **TBA — awaiting opponents**. As soon as both feeder winners are confirmed, the next match is created without inheriting a previous match's time or court. MT can announce its time and court while unrelated fixtures remain unfinished; the entire round need not finish first. Waiting slots with unknown opponents stay TBA until their fixture is confirmed. Byes are automatic advancement and have no playing time.

The date/time input explicitly uses Malaysia time (MYT), regardless of the device timezone. Saving runs the existing court, player-rest and official conflict checks and refreshes personal schedules and tournament previews. MT/Admin permission is checked on the server; EXCO can assign officials but cannot change match times. Started matches and closed tournaments remain locked. This navigation/timezone fix reuses the existing `schedule_match` database function and needs no new migration.

---

## 2. Player User Flows

### Flow P1: Account Registration & Domain Authentication
* **Actor:** Player / Student
* **Pre-condition:** User opens the UMPSAce web app.
[ Unauthenticated User ]
│
▼
[ Click Login / Register ]
│
▼
[ Enter Email (@adab.umpsa.edu.my) & Password ]
│
▼
[ Server Domain Validation ] ──(Invalid Domain)──► [ Display Error: "UMPSA domain required" ]
│
(Valid Domain)
▼
[ Supabase Auth Token Created ] ──► [ Redirect to Player Dashboard ]
1. User navigates to the login screen and selects **Register with Email**.
2. User enters full name, matric number, and email ending in `@adab.umpsa.edu.my`.
3. System executes server-side validation on the email domain:
   - **Fail:** Rejects attempt and displays a security alert.
   - **Pass:** Creates Supabase auth user record and sends confirmation email.
4. User logs in and is redirected to the **Player Dashboard**.

---

### Flow P2: Tournament Browsing & Category Registration
* **Actor:** Player
* **Pre-condition:** Player is logged in and an active tournament has status `REGISTRATION_OPEN`.

1. Player navigates to **Browse Tournaments** and selects a tournament (e.g., *UMPSA Campus Open*).
2. Player views category details (e.g., *Men's Singles*, 32 Max Capacity).
3. Player clicks **Register for Category**.
4. System executes registration verification:
   - *Check 1:* Is the user authenticated?
   - *Check 2:* Is the tournament status `REGISTRATION_OPEN`?
   - *Check 3:* Is the user already registered in this category?
   - *Check 4:* Is the category at maximum player capacity?
5. **Branching Outcomes:**
   - **Capacity Available:** System inserts record into `tournament_registrations` with status `CONFIRMED`. System displays confirmation badge.
   - **Category Full:** System prompts: *"Category is full. Would you like to join the Waitlist?"* Player confirms $\rightarrow$ System inserts record with status `WAITLISTED` and logs registration timestamp.

---

### Flow P3: Player Match Schedule & Live Bracket View
* **Actor:** Player
* **Pre-condition:** Official draw has been published by the Organizer (`DRAW_PUBLISHED`).

1. Player receives a notification or clicks **My Matches** on their dashboard.
2. Dashboard displays upcoming match card: Opponent Name, Court Number, Scheduled Time, and Estimated Start Time.
3. Player clicks **View Group Standings**:
   - System renders real-time table displaying Pld, W, L, PW, PL, NP (Net Points), and Standings Points.
4. Player clicks **Live Scoreboard** during match time:
   - Supabase Realtime WebSocket subscribes player to court updates, rendering live point changes without page refresh.

---

## 3. Organizer User Flows

### Flow O1: Tournament Setup & Category Configuration
* **Actor:** Organizer (`ADMIN` role)
* **Pre-condition:** Organizer logged in.

1. Organizer clicks **Create Tournament** on Admin Portal.
2. Inputs metadata: Tournament Title, Location, Dates, Number of Physical Courts (e.g., Courts 1–6).
3. Configures Category & Rules:
   - Selects Category: *Men's Singles*.
   - Defines Scoring Format: *Standard 3x21* or *Single Set 1x30*.
   - Sets Interval Rules: *2-min rest at 11 pts* (or 15 pts for 1x30).
   - Sets Rest Period Guardrail: *Minimum 20 minutes between matches*.
4. Organizer sets status to `REGISTRATION_OPEN`.

---

### Flow O2: Seed Selection & Automated Draw Execution
* **Actor:** Organizer
* **Pre-condition:** Registration deadline passed; status updated to `REGISTRATION_CLOSED`.

[ Select Seeded Players ] ──► [ Click "Start Automated Draw" ] ──► [ Validation Engine Checks ]
│
[ Draw Preview Screen ] ◄─── [ Generate Snake-Seed & Random Draw ] ──────────┘
│
├─────────────────────────┐
▼                         ▼
[ Click "Publish Draw" ]    [ Click "Regenerate" ]
│                         │
[ Status: DRAW_PUBLISHED ]  [ Re-run Algorithm ]


1. Organizer opens category management and selects **Seed Management**.
2. Tag registered players with Seed Numbers (e.g., Seed 1 to Seed 8).
3. Organizer clicks **Start Automated Draw**.
4. System executes pre-draw validation:
   - Verifies no duplicate seed numbers.
   - Verifies registered count meets minimum group threshold.
5. System runs seeding algorithm:
   - Assigns exactly 1 Seeded Player per group column (Groups A through H).
   - Shuffles unseeded players randomly across remaining slots using Fisher-Yates algorithm.
6. System renders **Draw Preview Screen**:
   - Organizer reviews group compositions.
   - **Option A:** Click **Regenerate** $\rightarrow$ Re-shuffles unseeded players.
   - **Option B:** Click **Publish Draw** $\rightarrow$ Changes status to `DRAW_PUBLISHED`, generates round-robin group match schedule, and triggers notification to all players.

---

### Flow O3: Assigning Officials (Umpire & Linesman)
* **Actor:** Organizer
* **Pre-condition:** Tournament schedule generated.

1. Organizer opens **Official Assignment Portal**.
2. Selects a match or physical court slot (e.g., *Court 3 - Match #12*).
3. Selects a user from the Official Roster pool.
4. Assigns role: `UMPIRE` or `LINESMAN`.
5. System runs conflict guardrail check:
   - *Conflict Check:* Is the assigned official scheduled to play a match as a player within 30 minutes of this slot?
   - **If Conflict Detected:** System blocks assignment and displays red alert: *"User [Name] is playing on Court 1 at 10:30 AM."*
   - **If Clean:** System locks assignment and pushes notification to the Official's dashboard.

---

### Flow O4: Live Tournament Monitoring & Referee Override
* **Actor:** Organizer
* **Pre-condition:** Group stage or Knockout stage matches `IN_PROGRESS`.

1. Organizer views **Global Multi-Court Dashboard** showing all courts in real-time.
2. **Scenario: Official Discrepancy or Technical Issue:**
   - Organizer clicks **Court 2 Control Modal**.
   - Selects **Referee Override Mode**.
   - Manually adjusts score or changes match status to `WALKOVER` / `RETIRED`.
   - Inputs mandatory audit reason: *"Player A retired due to knee injury."*
3. System updates database, recalculates group Net Points instantly, and logs the action into `audit_logs`.

---

## 4. Official (Umpire & Linesman) User Flows

### Flow U1: Official Context Switching & Court Check-In
* **Actor:** User with `OFFICIAL` capability
* **Pre-condition:** User logged into app.

1. User opens dashboard and sees **Official Duty** tab.
2. System renders assigned duties for the day:
   - *10:00 AM - Court 1 (Role: Umpire)*
   - *11:30 AM - Court 3 (Role: Linesman)*
3. User selects 10:00 AM assignment $\rightarrow$ App loads **Umpire Scoring Mode**.
4. User selects 11:30 AM assignment $\rightarrow$ App loads **Linesman Read-Only Check-In Mode**.
5. Linesman taps **Check-In at Court** $\rightarrow$ Organizer dashboard displays green checkmark for Linesman attendance.

---

### Flow U2: Umpire Live Courtside Scoring Flow
* **Actor:** Assigned Umpire
* **Pre-condition:** Players present at assigned court; match status `READY`.

[ Start Match ] ──► [ Live Scoring Screen ] ──► [ Point +1 Player A / B ]
│                               │
▼                               ▼
[ Interval Trigger ]             [ Point Reached 21 / 30 ]
(11 pts / 2-min timer)                        │
│                               ▼
└──────────────► [ Prompt: Game / Match Point ]
│
▼
[ Digital Sign-off & Lock ]


1. Umpire taps **Start Match** $\rightarrow$ Match status changes to `IN_PROGRESS`.
2. Umpire controls score using large, mobile-friendly touch buttons (**+1 Player A**, **+1 Player B**):
   - System automatically calculates deuce and game point conditions.
3. **Interval Trigger:** When the first player reaches 11 points (or 15 points in 1x30 format), system triggers 2-minute interval countdown screen with alarm toggle.
4. **Discipline Logging:** Umpire can tap **Card** button to issue Yellow Card or Red Card for delay/conduct violations.
5. **Match Completion:** Upon winning point:
   - System displays **Match Summary Screen** showing final set scores.
   - Umpire verifies winner and taps **Digital Sign-off & Submit**.
   - Match status updates to `COMPLETED`. Scoring interface locks permanently for Umpire.
   - System automatically triggers group standings recalculation (`NP = PW - PL`).

---

## 5. Knockout Progression Flow

### Flow K1: Crossover Bracket Generation
* **Actor:** System / Organizer Trigger
* **Pre-condition:** All group stage matches marked `COMPLETED`.

1. Organizer clicks **Advance to Knockout Stage**.
2. Tournament Engine calculates final group rankings:
   - Sorts by Standings Points.
   - Applies **Net Points (NP)** tiebreaker for draw records.
   - Applies Head-to-Head tiebreaker if NP is equal.
3. Tournament Engine populates crossover single-elimination bracket:
   - Group A Winner vs Group H Winner (or Runner-Up based on crossover rules).
   - Group B Winner vs Group G Winner.
4. System updates status to `KNOCKOUT_IN_PROGRESS` and publishes visual bracket tree
