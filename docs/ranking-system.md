# UMPSA Player Ranking System

**Document Version:** 1.0  
**Related Documents:** `product-requirement.md`, `tournament-rules.md`, `match-rules.md`  
**Governance Standard:** UMPSA Badminton Tournament Board Standard Operating Procedure

---

## 1. Executive Summary

This document establishes the authoritative rules and logic for the global **UMPSA Player Ranking System**. Operating on a Premier League-style Point Accumulation Model, this system rewards consistent participation and competitive performance across all university badminton tournaments. Rankings are compiled on a global leaderboard that updates dynamically upon the official completion of each tournament.

### League table presentation — 5 November 2026

The player directory includes everyone who has entered a tournament category, including accepted doubles partners and existing historical ranking holders. Confirmed, waitlisted and retained withdrawn registrations establish directory membership; pending partner invitations and accounts without entries do not. Players appear with zero statistics before their first tournament's ranking publication. A name is shown once across all categories and tournaments.

Display Pos, Player, P, W, L, GW (games won), PF, PA, NP, participation credits, Win %, recent form and Pts. P counts finalized published fixtures, including walkovers; a no-show therefore records a loss but receives no participation credit. Pts is `3 × W + GW + participation credits`, never football's draw-point model. Form shows the last five published results and is not a tie-breaker.

Apply sections 3.1–3.4 in order. Unresolved ties share their position (for example 1, 1, 3); alphabetical order only stabilizes display and awards no advantage. The most recent opposing-side result resolves exactly two tied players, including doubles opponents. Teammates do not have a head-to-head result against each other.

---

## 2. Points Accumulation Model (Accumulator Model)

Rather than utilizing a decay-only or placement-only ranking system, the UMPSA Player Ranking System operates on an accumulative model where players earn Ranking Points ($RP$) for every match played, set won, and tournament entered during a single academic season.

### 2.1 Points Allocation Structure
For each match played within an authorized UMPSA tournament, a player accumulates Ranking Points according to the following fixed weights:

| Achievement Event | Points Awarded | Description |
| :--- | :--- | :--- |
| **Match Win** | `+3 RP` | Awarded to the winner of the match (applies to both group-stage and knockout matches). |
| **Set/Game Won** | `+1 RP` | Awarded for each individual game/set won within a match (e.g., winning 2-1 awards `+2 RP` for sets won; losing 1-2 still awards `+1 RP` for the single set won). |
| **Participation** | `+1 RP` | Awarded for each scheduled match in which the player participates on-court (walkovers do not count as on-court participation for the player failing to appear). |

### 2.2 Points Calculation Formula
For any single match $m$, the Ranking Points earned by a player ($RP_m$) is calculated as:
$$RP_m = (\text{Match Win} \times 3) + (\text{Sets Won} \times 1) + (\text{Participation} \times 1)$$

*Note: Walkovers are treated specially as defined in Section 5.1 of this document.*

---

## 3. Leaderboard Tiebreaker Rules (Draw Situation)

When two or more players accumulate an identical number of total Ranking Points ($RP$) on the global leaderboard, their ranking order on the leaderboard is determined by applying the following sequential tiebreaking rules.

### 3.1 Primary Tiebreaker: Cumulative Net Points (Cumulative NP)
The primary tiebreaker is determined by the player's Cumulative Net Points across all historical matches played during the current academic season.
$$NP_{\text{cumulative}} = \text{Total Rally Points Won} - \text{Total Rally Points Lost}$$
* **Rule:** The player with the higher Cumulative Net Points is ranked higher.
* **Scope:** This counts every individual rally point scored and conceded in every game of all matches.

### 3.2 Secondary Tiebreaker: Total Matches Won
If Cumulative Net Points are equal, the tie is resolved by the absolute volume of matches won.
* **Rule:** The player with the higher number of total matches won across the season is ranked higher.

### 3.3 Tertiary Tiebreaker: Win Percentage
If players remain tied, the tie is resolved by their match-winning efficiency.
* **Rule:** The player with the higher overall Win Percentage is ranked higher. Win Percentage is calculated as:
$$\text{Win Percentage} = \left( \frac{\text{Total Matches Won}}{\text{Total Matches Played}} \right) \times 100\%$$

### 3.4 Quaternary Tiebreaker: Head-to-Head Record
If a tie still persists between exactly two players, their head-to-head performance is evaluated.
* **Rule:** The winner of the most recent head-to-head match between the two tied players during the academic season is ranked higher. If they have not played each other, or if more than two players remain tied, they will share the tied rank on the leaderboard.

---

## 4. Ranking Persistence, Updates & Archiving

### 4.1 Update Trigger
* **The COMPLETED State Transition:** Ranking Points and tiebreaker statistics are not updated dynamically during live matches. Calculations are executed and committed to the database only when an entire tournament has been officially marked as `COMPLETED` by the Organizer.
* **Transaction Integrity:** The update process must be executed as a single database transaction. All tournament matches, set scores, and rally points are processed to update the global standings table atomically to prevent partial or corrupted updates.

### 4.2 Season Archiving & Reset
* **Academic Year/Semester Boundary:** Rankings operate on a single academic season. At the conclusion of each academic season, the leaderboard is frozen.
* **Archive Log:** The system takes a snapshot of the final season leaderboard and stores it in the `historical_leaderboards` archive, tagged with the respective academic year and semester (e.g., `2026/2027 Semester 1`).
* **Reset to Zero:** Once archived, all players' active Ranking Points, Cumulative Net Points, and match statistics are reset to 0 to begin the next academic season.

---

## 5. Edge Cases & Special Conditions

### 5.1 Walkovers & Forfeits
* **Winning Player (Recipient of Walkover):** Awarded a Match Win (`+3 RP`), sets won points matching the walkover scoring convention (`+2 RP` for 21-0, 21-0 or `+1 RP` for 30-0), and the participation point (`+1 RP`). Cumulative Net Points are updated based on the walkover scoring convention (+42 rally points for standard, +30 for single set).
* **Losing Player (Absentee):** Receives `0 RP` for the match and does not receive the participation point. Cumulative Net Points are updated based on the walkover scoring convention (-42 rally points for standard, -30 for single set).

### 5.2 Match Retirements (Incomplete Matches)
* **Retiring Player:** Retains the actual sets won up to the point of injury (earning `+1 RP` per set won) and receives the `+1 RP` participation point, but earns `0 RP` for the match win. Cumulative Net Points are calculated using actual points scored up to retirement and conceded points from unplayed sets as specified in `docs/match-rules.md`.
* **Opponent (Declared Winner):** Awarded a Match Win (`+3 RP`), sets won points based on the final completed/awarded sets (`+2 RP`), and the participation point (`+1 RP`). Cumulative Net Points are calculated using actual points scored and points awarded for the remainder of the match.
