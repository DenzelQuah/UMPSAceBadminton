# UMPSA Tournament Notification System Specification

## Live scoring - 9 November 2026

See `docs/realtime-scoring.md`. Per-point writes use `adjust_match_point` with an immutable operation UUID and expected snapshot version, followed by database-owned private category Broadcast. Do not replace this with absolute-score overwrites, client-originated broadcasts or per-point page refreshes. Umpire controls lock on disconnect and reopen only after authoritative catch-up; an uncertain point retries the same UUID. Group Preview updates only affected score cards.

**Document Version:** 1.0  
**Related Documents:** `product-requirement.md`, `user-roles.md`, `user-flows.md`, `scheduling-system.md`, `database-schema.md`  
**Governance Standard:** UMPSA Badminton Tournament Board Standard Operating Procedure

---

## 1. Executive Summary

This document specifies the event-driven notification architecture for **UMPSAce Badminton**. The system ensures real-time operational coordination among Organizers, Competitors, and Officials. By integrating persistent transaction logs, immediate WebSocket broadcasts, and campus email deliveries, the notification engine guarantees that participants are kept informed of registrations, schedule adjustments, draw publications, and courtside assignments.

---

## 2. Notification Delivery Channels

The platform uses two primary delivery channels to ensure high visibility, low-latency scoring synchronization, and offline reachability.

```
                  [ Event Triggered ]
                           │
             ┌─────────────┴─────────────┐
             ▼                           ▼
    [ Realtime Channel ]        [ Email Channel ]
   - Supabase Realtime         - Transactional Email
   - Low Latency (WebSockets)  - Verified Campus Domains
   - Active Client Dashboards  - Offline Reachability
```

### 2.1 In-App Realtime Alerts (WebSocket Broadcast)
* **Technology:** Powered by **Supabase Realtime WebSockets**.
* **Behavior:** When an event is triggered, a payload is broadcasted on a specific user channel (`user_notifications:{user_id}`).
* **Client Handling:** Active clients subscribe to their user channel. Upon receiving a WebSocket frame, the client app instantly renders a toast notification and increments the global dashboard notification badge without requiring a page refresh.

### 2.2 Transactional Email (Campus Domain Delivery)
* **Domain Restrictions:** Restrict email dispatches to verified institutional email addresses only:
  * Student Competitors: `@adab.umpsa.edu.my`
  * Staff & Admin Organizers: `@umpsa.edu.my`
* **Behavior:** Transactional emails are queued and dispatched via a secure background worker to ensure UI threads are never blocked by email server latencies.

---

## 3. Automated Event Triggers & Payloads

The notification engine automatically handles five core transactional events based on specific database mutations or temporal triggers.

### 3.1 Registration Lifecycle
* **Trigger:** An insert or update action in the `tournament_registrations` table (status transitioning to `CONFIRMED` or `WAITLISTED`).
* **Delivery Channel:** Transactional Email + In-App Notification.
* **Payload Structure:**
  ```json
  {
    "type": "REGISTRATION_CONFIRMED",
    "title": "Registration Confirmed - UMPSA Badminton Open",
    "body": "Hi {player_name}, your registration for {category_name} is confirmed. Registration ID: {reg_id}.",
    "waitlist_status": false
  }
  ```
* **Waitlist Promotion Trigger:** When an Organizer withdraws a competitor, promoting the next waitlisted player, the database trigger mutates the status from `WAITLISTED` to `CONFIRMED`.
* **Payload Structure (Waitlist Promotion):**
  ```json
  {
    "type": "WAITLIST_PROMOTED",
    "title": "Promoted to Competitor Pool!",
    "body": "Hi {player_name}, a slot has opened up in {category_name}. You have been promoted from the waitlist and are now officially registered!"
  }
  ```

### 3.2 Draw Publication
* **Trigger:** An Organizer updates the tournament category status to `DRAW_PUBLISHED`.
* **Delivery Channel:** Transactional Email + In-App Broadcast.
* **Payload Structure:**
  ```json
  {
    "type": "DRAW_PUBLISHED",
    "title": "Official Tournament Draw Published",
    "body": "The official group draw for {category_name} has been published. Check your dashboard to view your assigned group opponents.",
    "action_url": "/dashboard/tournaments/{tournament_id}/draw"
  }
  ```

### 3.3 T-24 Hours Schedule Broadcast
* **Trigger:** Scheduled daily cron-job executing exactly **24 hours prior** to the official start date of the tournament.
* **Delivery Channel:** Transactional Email.
* **Job Behavior:** The cron worker aggregates all scheduled matches for each player, compiling their court assignments, match times, and opponent details into a personalized daily digest.
* **Payload Structure:**
  ```json
  {
    "type": "SCHEDULE_DIGEST_24H",
    "title": "Your Match Schedule - {tournament_name}",
    "matches": [
      {
        "match_id": "MS-012",
        "opponent": "Ahmad Bin Ali",
        "court": "Court 3",
        "scheduled_time": "09:00 AM",
        "estimated_start": "09:00 AM"
      },
      {
        "match_id": "MS-018",
        "opponent": "Tan Wei Jie",
        "court": "Court 1",
        "scheduled_time": "11:20 AM",
        "estimated_start": "11:40 AM"
      }
    ]
  }
  ```

### 3.4 Live Court Call (T-15 Minutes)
* **Trigger:** When a court is marked "Vacant" and a match is scheduled 15 minutes away from starting, or when the Organizer manually triggers a court call.
* **Delivery Channel:** In-App Realtime Toast Alert.
* **Payload Structure:**
  ```json
  {
    "type": "COURT_CALL_15M",
    "title": "Court Call: Proceed to Assigned Court",
    "body": "Match #{match_number}: {player_a_name} vs {player_b_name}. Please proceed immediately to Court {court_number} for warmup.",
    "vibrate": true
  }
  ```

### 3.5 Schedule Recovery Alert
* **Trigger:** The scheduling engine pulls a future match forward due to early court availability, and the Organizer approves the re-allocation.
* **Delivery Channel:** In-App Realtime Toast Alert + High-Priority Email.
* **Payload Structure:**
  ```json
  {
    "type": "SCHEDULE_RECOVERY",
    "title": "Schedule Update: Match Pulled Forward",
    "body": "Hi {player_name}, due to early court availability, your match against {opponent_name} has been pulled forward to Court {court_number} at {new_time} (previously {old_time}).",
    "new_time": "10:15 AM",
    "old_time": "10:40 AM"
  }
  ```

---

## 4. Official Duty Notifications

Because officials (Umpires and Linesmen) coordinate court flow, they receive specialized real-time instructions.

### 4.1 Umpire Match Assignment
* **Trigger:** Organizer logs an umpire assignment for a specific match.
* **Delivery Channel:** In-App Realtime Alert.
* **Payload Structure:**
  ```json
  {
    "type": "UMPIRE_ASSIGNMENT",
    "title": "New Umpire Duty Assigned",
    "body": "You have been assigned to officiate Match #{match_number} ({player_a_name} vs {player_b_name}) on Court {court_number} at {scheduled_time}.",
    "action_url": "/officials/umpire/{match_id}"
  }
  ```

### 4.2 Linesman Match Assignment
* **Trigger:** Organizer logs a linesman assignment for a specific court/match slot.
* **Delivery Channel:** In-App Realtime Alert.
* **Payload Structure:**
  ```json
  {
    "type": "LINESMAN_ASSIGNMENT",
    "title": "New Linesman Duty Assigned",
    "body": "You have been assigned as Line Judge for Court {court_number} starting at {scheduled_time} (Match #{match_number}). Please check-in upon arrival."
  }
  ```

### 4.3 Official Duty Schedule Adjustments
If a court delay occurs or a match is reassigned, any assigned official is instantly sent an adjustment notice so they can relocate courts.

---

## 5. Database Logging & Auditing

To ensure data integrity, delivery tracking, and administrative accountability, all notifications must be registered in the centralized database.

### 5.1 The `notification_logs` Schema Definition
Every dispatch—regardless of delivery channel—must insert a record into the database mapping the following attributes:

| Column Name | Data Type | Constraint | Description |
| :--- | :--- | :--- | :--- |
| `id` | `UUID` | Primary Key, `DEFAULT gen_random_uuid()` | Unique notification event identifier. |
| `user_id` | `UUID` | Foreign Key $\rightarrow$ `users.id` | Target recipient identifier. |
| `type` | `VARCHAR` | `NOT NULL` | Notification event type (e.g., `REGISTRATION_CONFIRMED`, `COURT_CALL_15M`). |
| `channel` | `VARCHAR` | `CHECK (channel IN ('IN_APP', 'EMAIL', 'BOTH'))` | The dispatched routing path. |
| `title` | `VARCHAR` | `NOT NULL` | Rendered subject line. |
| `body` | `TEXT` | `NOT NULL` | The formatted message content. |
| `payload` | `JSONB` | `NOT NULL` | The structured data payload (parameters used). |
| `delivery_status` | `VARCHAR` | `CHECK (delivery_status IN ('PENDING', 'SENT', 'FAILED'))` | Tracks transaction outcome. |
| `read_at` | `TIMESTAMP` | `NULLABLE` | Timestamp when the user opened the alert (In-App). |
| `created_at` | `TIMESTAMP` | `NOT NULL, DEFAULT now()` | Generation timestamp. |

### 5.2 Delivery Analytics & Troubleshooting
Organizers must have visibility of delivery status via the Administrator Portal to debug disputes (e.g., a player claiming they never received a court call). The dashboard displays delivery status logs (`SENT` or `FAILED`) alongside read receipts (`read_at` timestamp) fetched directly from the audited log.
