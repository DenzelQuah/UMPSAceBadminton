# UMPSAce Badminton - In-Game Match Rules & Scoring Specification

**Doubles extension, 5 November 2026:** The two sides can be accepted pairs. Scores, games, disciplinary penalties, standings and declared winners apply to the side. The representative ID identifies the side; this does not exclude the partner from scheduling checks, match access or earned ranking points. Individual doubles service rotation remains manual.

**Document Version:** 1.0  
**Related Documents:** `product-requirement.md`, `user-flows.md`, `tournament-rules.md`, `ui-design-system.md`  
**Governance Standard:** Aligned with Badminton World Federation (BWF) Laws of Badminton

---

## 1. Executive Summary

This document establishes the authoritative rules for live court scoring, interval timing, disciplinary penalties, and match termination in UMPSAce Badminton. The rules defined here govern the behavior of the **Umpire Live Scoring Interface** and dictate how points are recorded into the database for group standings calculations.

---

## 2. Supported Match Formats

Organizers configure the scoring format during tournament category creation. The system must natively support two distinct scoring models:

### 2.1 Standard Format (Best of 3 Games x 21 Points)
* **Game Structure:** A match consists of the best of 3 games (first player to win 2 games wins the match).
* **Winning a Game:** The side that first scores **21 points** wins the game, subject to deuce extension rules.
* **Scoring System:** Rally Point Scoring (a point is scored on every serve regardless of which side served).

### 2.2 Single Set Format (1 Game x 30 Points)
* **Game Structure:** A match consists of a single high-intensity game (common for university group stages to conserve court time).
* **Winning the Match:** The side that first scores **30 points** wins the match.

---

## 3. Deuce & Hard Cap Rules

To prevent endless matches while respecting competitive fairness, the scoring engine must automatically enforce BWF deuce and capping thresholds.

### 3.1 Standard Format Deuce (21-Point Format)
* **Deuce Trigger:** If the score reaches **20-20**, the game extends into deuce.
* **Win by Two:** A side must gain a 2-point lead to win the game (e.g., **22-20**, **25-23**).
* **The 30-Point Hard Cap:** If the score reaches **29-29**, the rule of winning by 2 points is overridden. The side scoring the **30th point** wins the game (**30-29** is the absolute maximum possible score).

### 3.2 Single Set Deuce (30-Point Format)
* **Sudden Death Cap:** In the 30-point single set format, there is no deuce extension beyond 30. If the score reaches **29-29**, the side that scores the **30th point** immediately wins the match (**30-29**).

---

## 4. Mandatory Rest Intervals & Automated Timers

The live scoreboard UI must automatically prompt the Umpire to trigger a rest interval when score thresholds are met.

### 4.1 Mid-Game Intervals
* **In 21-Point Games:** When the leading side reaches **11 points**, a mandatory **60-second** rest interval is triggered.
* **In 30-Point Games:** When the leading side reaches **15 points**, a mandatory **2-minute (120-second)** rest interval is triggered.
* **UI Behavior:** The Umpire tablet displays a full-screen countdown timer with an audible buzzer alert at 10 seconds remaining.
* **Once per game:** The mid-game interval is armed only when a game crosses its threshold. A later point at the same threshold must not restart the timer; each game receives at most one mid-game interval.

### 4.2 Between-Game Intervals (Standard Format Only)
* A mandatory **2-minute (120-second)** rest interval is enforced between Game 1 and Game 2, and between Game 2 and Game 3 (if a deciding game is required).
* When the timer ends, the scoring console automatically selects the next game and enables its scoring controls.

---

## 5. Disciplinary System & Card Penalties

Umpires have full authority to issue disciplinary cards for misconduct, delay of game, or court dissent. The scoring engine must automatically apply BWF point penalties when cards are logged.

### 5.1 Yellow Card (Formal Warning)
* **Trigger:** Issued for minor offenses (e.g., delaying serve, unauthorized court departure).
* **System Impact:** Logs a warning timestamp in the database (`match_events` table) visible on the scoreboard. **No point penalty is applied.**

### 5.2 Red Card (Fault / Point Penalty)
* **Trigger:** Issued for repeated misconduct after a Yellow Card, or for egregious breaches of conduct.
* **System Impact:** 
  1. Logs a fault in the database.
  2. **Automatically awards +1 point to the opponent's score.**
  3. Transfers service right to the opponent if the penalized player was serving.

### 5.3 Black Card (Disqualification)
* **Trigger:** Severe breaches of sportsmanship or persistent defiance of the Umpire.
* **System Impact:** An Umpire cannot issue a Black Card independently. The Umpire taps **Call Referee**, which alerts the Organizer dashboard. Only an Organizer/Referee account can confirm a Black Card, instantly terminating the match with a status of `DISQUALIFIED`.

---

## 6. Edge Case Scoring: Walkovers, Retirements & Forfeits

To ensure the Group Stage Net Points ($NP = PW - PL$) algorithm in `docs/tournament-rules.md` calculates fairly without skewing standings, incomplete matches must follow strict database recording conventions.

### 6.1 Walkover (No-Show)
If Player B fails to arrive at the court within 10 minutes of the scheduled time:
* **Match Status:** Marked as `WALKOVER`.
* **Score Recorded:** Player A is awarded a **21-0, 21-0** victory (or **30-0** in Single Set format).
* **Standings Impact:** Player A receives maximum Standings Points and a +42 Net Point differential. Player B receives 0 Standings Points and -42 Net Points.

### 6.2 Retirement (Mid-Match Injury)
If Player B suffers an injury and retires during a match while trailing **15-10** in Game 1:
* **Match Status:** Marked as `RETIRED`.
* **Score Recorded:** The retiring player retains their actual points scored (**10 points**), but the opponent is automatically awarded the points required to win the remaining games (recorded as **21-10, 21-0**).
* **Standings Impact:** Protects Player A's Net Point differential without erasing the effort already played on court.

---

## 7. Match Sign-Off & State Immutability

1. Upon scoring the winning point, the Umpire UI locks point increment buttons and presents the **Match Verification Modal**.
2. The Umpire must confirm the final score and tap **Submit Official Result**.
3. Upon submission, the database transitions `match_status` to `COMPLETED`.
4. **Immutability Guard:** The record becomes permanently read-only for the Umpire. Further edits require an Admin override via the Organizer Dashboard.
