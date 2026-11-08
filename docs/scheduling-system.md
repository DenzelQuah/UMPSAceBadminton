# UMPSA Tournament Scheduling & Court Allocation Engine

**Document Version:** 1.0  
**Related Documents:** `product-requirement.md`, `user-roles.md`, `user-flows.md`, `tournament-rules.md`, `match-rules.md`  
**Governance Standard:** UMPSA Badminton Tournament Board Standard Operating Procedure

---

## 1. Executive Summary

This document defines the mathematical modeling, database integration, and operational algorithms for the **UMPSA Court Allocation & Match Scheduling Engine**. The scheduling system is designed as a formal **Constraint Satisfaction Problem (CSP)**, ensuring that matches are allocated to courts and time slots in a conflict-free manner while optimizing venue efficiency and competitor welfare.

The engine coordinates three core tournament resources:
1. **Courts** (physical facilities).
2. **Competitors** (players assigned to match fixtures).
3. **Officials** (umpires and linesmen assigned to officiate fixtures).

---

## 2. Temporal & Physical Resource Modeling

To structure the Constraint Satisfaction Problem (CSP), time is discretized into fixed blocks, and physical assets are formally bound.

### 2.1 Standard Match Time Blocks
The basic unit of schedule allocation is the **40-minute Time Slot**. This block is modeled as follows:
* **Estimated Active Playtime:** 30–35 minutes (covers warmups, standard sets, or single set formats).
* **Changeover & Reset Buffer:** 5–10 minutes (allocated for player exit/entry, court sweeping, and score sign-off).
* **Daily Schedule Matrix:** Daily operational schedules are represented as $T = \{t_1, t_2, \dots, t_n\}$ where each $t_i$ represents a 40-minute slot beginning at the venue's opening hour.

### 2.2 Court Representation
Physical courts are modeled as a finite set $C = \{c_1, c_2, \dots, c_m\}$ where $m$ is the maximum number of courts configured by the Organizer during tournament category setup.

---

## 3. The Constraint Satisfaction Problem (CSP) Model

The core of the scheduling engine is a CSP algorithm solved via recursive backtracking, forward checking, and heuristic-based ordering.

Let:
* $M = \{m_1, m_2, \dots, m_k\}$ be the set of match fixtures to be scheduled.
* $X_i = (t, c)$ be the decision variable for match $m_i$, where $t \in T$ is a 40-minute time slot and $c \in C$ is an allocated court.

### 3.1 Hard Constraints (Zero-Tolerance Rules)
A scheduling solution is considered invalid if any of the following constraints are violated. The engine must reject any configuration—automatic or manual—that breaches these bounds.

#### 1. Player Conflict Prevention
A competitor cannot be scheduled to play on two courts simultaneously.
$$\text{For any two matches } m_i, m_j \text{ sharing competitor } p: \quad t(m_i) \neq t(m_j)$$

#### 2. Mandatory Rest Guardrail
To preserve athletic health and prevent competitive fatigue, any participant scheduled in consecutive matches must receive a strict minimum rest window of **20 minutes**.
$$\text{If competitor } p \text{ plays in } m_i \text{ and } m_j \text{, where } \text{Start}(m_j) > \text{Start}(m_i): \quad \text{Start}(m_j) - \text{End}(m_i) \ge 20 \text{ minutes}$$
Since time is allocated in 40-minute blocks, this effectively means a player cannot play in back-to-back time slots. A player must have at least one full 40-minute slot vacant ($t_{i+1}$) before they can play again ($t_{i+2}$).

#### 3. Official Conflict Guardrail
An Umpire or Linesman cannot be scheduled to officiate a match if they are playing a match within a **30-minute buffer window** before or after their active playing duty.
$$\text{If user } u \text{ plays in } m_i \text{ and is assigned to officiate } m_j: \quad |\text{Start}(m_j) - \text{Start}(m_i)| \ge 70 \text{ minutes}$$
*(Note: 70 minutes represents the 40-minute playing block plus the 30-minute rest buffer.)*

#### 4. Physical Court Availability & Facility Limits
Matches can only be assigned to courts that exist within the venue index, and the start times must lie strictly within the venue's daily operating bounds defined by the Organizer.
$$\forall m_i, \quad c(m_i) \in C \quad \text{and} \quad \text{Start}(m_i) \ge \text{VenueOpen}, \quad \text{End}(m_i) \le \text{VenueClose}$$

---

### 3.2 Soft Priorities (Optimization Goals)
When multiple conflict-free solutions exist, the scheduling engine evaluates a multi-objective scoring function to select the optimal schedule layout.

1. **Minimize Idle Court Gaps:** Maximize court utilization by scheduling matches back-to-back on Court $c_j$ before populating Court $c_{j+1}$, minimizing hollow gaps in court resource allocation.
2. **Equitable Rest Time Distribution:** Distribute rest periods evenly across competitors in the same pool. Avoid scheduling Player A with three consecutive rest slots while Player B is forced to play under minimum rest limits.
3. **Age & Category Freshness Priority:** Prioritize Men's Singles and Women's Singles matches earlier in the day when competitors are physically freshest, shifting doubles and secondary category tiers toward later blocks.

---

## 4. Dynamic Re-allocation & Real-Time Recovery

Tournaments on physical courts are highly dynamic. Matches may end early due to injury/retirements or run over due to extreme deuces. The system must adapt to live feedback from the Umpire Live Scoring Interface.

### 4.1 Fast-Path Recovery (Courts Finishing Early)
If Court 2 completes Match #4 in 15 minutes (e.g., due to walkover or retirement):
* **Pull-Forward Flag:** The system identifies Court 2 as "Vacant" and scans the subsequent time slots for the next scheduled match on Court 2 (or any court) where:
  1. Both scheduled players are checked-in.
  2. Both players have met their **20-minute rest guardrail** relative to any previously played matches.
  3. The assigned Umpire and Linesman are checked-in and free.
* **Organizer Approval Portal:** The system prompts the Organizer with a recovery alert: *"Match #8 can be pulled forward to Court 2 at 10:15 AM (estimated saving: 25 minutes). Approve re-allocation?"*
* **Trigger:** Upon approval, the system re-allocates the match, adjusts the estimated start time, and fires automatic push alerts to the respective players and officials.

### 4.2 Shift-Forward Path (Schedules Running Over)
If Match #10 on Court 1 runs over the 40-minute allocation (e.g., reaching 30-29 in a single set):
* **Ripple Delay Warning:** The system dynamically recalculates the "Estimated Start Time" for all subsequent matches assigned to Court 1, shifting them forward by the calculated delay (e.g., +15 minutes).
* **Cross-Court Rest Balancing:** If a shifted start time causes a downstream conflict with a player scheduled to play on Court 2 later, the system highlights the conflict in yellow on the Organizer dashboard, allowing the Organizer to manually drag-and-drop the conflicting fixture onto an open court.

---

## 5. Database Representation & State Management

Scheduling state transitions are tracked via database status checks to ensure consistency and prevent data corruption.

```
 [ SCHEDULED ] ──(Court & Time Slot Assigned)
       │
       ▼
   [ READY ] ──(Players & Officials Checked-In)
       │
       ▼
 [ IN_PROGRESS ] ──(Umpire clicks "Start Match")
       │
       ▼
  [ COMPLETED ] ──(Umpire clicks "Submit Result" -> Court Freed)
```

### 5.1 The Immutability Guard
* **Automatic Lock:** As soon as a match state updates to `READY` or `IN_PROGRESS`, its court and time-slot allocations are locked in the database.
* **Mutations Restricted:** The scheduling engine cannot mutate or automatically reschedule any match that has started. Only manual Administrator-level Referee Overrides can disrupt an active or completed court assignment.
