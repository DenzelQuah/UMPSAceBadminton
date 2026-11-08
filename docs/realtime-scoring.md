# Realtime scoring — 9 November 2026

The umpire console and player-facing Group Preview now use database-originated private Broadcast channels. They no longer poll the scoring server action or refresh a tournament page for each point.

## Point writes and correctness

- `adjustMatchPoint` authenticates the caller, validates a one-point increment/decrement, and makes one database RPC. It does not read profiles, categories or the operator event log on each click.
- `adjust_match_point` locks the match, checks the current approved umpire/management assignment and match state, and verifies the client's expected score version. Another device's intervening write returns `SCORE_CONFLICT` instead of overwriting it.
- Each click has an immutable UUID. A retry after an uncertain response uses the same UUID and original command. The database recognizes an already applied operation and returns the latest snapshot without applying a second point. Reusing a UUID with different parameters is rejected.
- Scores cannot go below zero or beyond the scoring format's rules. Games must be played in order. A final rally may be removed before sign-off if a subsequent game has not started. A signed-off match remains locked; management overrides retain their separate audited workflow.
- The score, live snapshot/version, idempotency record, audit and database broadcast are one transaction. An audit failure rolls all of them back. No unsaved optimistic point is shown as a database-confirmed score.

## Efficient audience updates

`live_match_scores` stores one compact snapshot per match: category/group IDs, status, winner, up to three game scores, version and update time. Protected triggers maintain it for point changes, legacy scoring operations, penalties, overrides and match-state changes. The initial migration backfills snapshots before installing the broadcaster, avoiding a burst of historical events.

`realtime.send` sends `score_changed` on `scores:category:<uuid>` after database commit. A small payload is fanned out to listeners without a per-viewer score query. A separate `draw_changed` event handles infrequent structural changes, such as match start/result, scheduling or bracket advancement; those page refreshes are coalesced over 500 ms. There is no full-page refresh on a point increment/decrement.

Published tournament pages show Group Preview cards and knockout score lines. Each category subscribes once. Match/group components retain stable props so unrelated group cards skip rendering. Version checks discard duplicate/reordered messages and prevent an older catch-up read from replacing a newer event. Listeners unsubscribe on unmount/category change.

## Connectivity

The client subscribes and then reads an authoritative snapshot before enabling scoring. Browser offline events and channel failures synchronously close the write gate; point handlers also check that gate, so rapid clicks cannot slip through before the next render. One in-flight command is allowed at a time. Buttons remain disabled with a persistent **Reconnecting...** toast until the connection and saved score are synchronized.

No new offline clicks are queued. An uncertain in-flight point is verified by retrying its original command/UUID after reconnection, with bounded exponential delay; it is never converted into a fresh click. Requests have a ten-second client deadline. The idempotency/version rules also cover a timed-out server request that later commits. Catch-up completion from a previous connection cannot unlock controls.

Healthy score streams do not poll. A lightweight 30-second snapshot catch-up runs only while disconnected and online/visible, plus catch-up on focus/visibility restoration. Tournament registration metadata retains one slow 60-second refresh, replacing the previous duplicate 5/10-second page polling. Missing snapshot setup is reported and scoring stays disabled.

## Access and installation

Run `20261108172058_realtime_match_scores.sql` after earlier migrations. Supabase's standard Realtime schema provides `realtime.send`, `realtime.messages` and `realtime.topic`. Broadcast uses private channel authorization rather than adding the tables to the Postgres Changes publication.

Existing institutional login requirements remain in place: “public” means the published player/audience view within the application. Players can read scores for published categories. Private draft scores remain management-only. There is no client INSERT policy for the score Broadcast topic, and direct score/idempotency table writes are revoked. The database always supplies the canonical payload.

`private.point_operations` keeps the operation UUIDs alongside the audit trail. Do not purge entries while a match can still have an uncertain in-flight request. A future archival policy can retain them together with match/audit retention.

## Validation

- `tests/live-scores.test.ts`: version ordering, per-match updates, subscribe/read gates, late reads after disconnect, reconnect catch-up, request coalescing, cleanup and deadlines.
- `tests/live-scoring-database.test.ts`: migration replay, real point writes, transactional Broadcast payloads through a local `realtime.send` stub, permissions, draft isolation, idempotency, stale-device conflicts, undo/final-lock rules and audit rollback.
- `tests/point-actions.test.ts`: authenticated one-RPC commands and structured conflict/setup/acknowledgement handling.

These tests run in isolated PostgreSQL and do not change hosted scores. A hosted WebSocket rehearsal requires applying the migration: use a separate test tournament with an assigned umpire, open its scoring console and published Group Preview on different devices, exercise +1/-1, disconnect/reconnect the umpire, and confirm that the displayed score matches the saved snapshot before controls reopen. Hosted schema/advisor checks require a linked owner connection.
