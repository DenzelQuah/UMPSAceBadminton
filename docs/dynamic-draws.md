# Dynamic draws and byes — 9 November 2026

This update replaces fixed group counts, minimum-eight knockout fields, and the previous rejection of non-power-of-two brackets. Tournament directors still review a private proposal before publishing it.

## Eligible entries

Each category uses its final `CONFIRMED` registrations after registration closes. Capacity is a registration ceiling, not the required draw size. Waitlisted and withdrawn registrations are excluded. One singles player is one entry; one accepted doubles pair is one entry. At least two entries are required; zero/one-entry fields cannot create a competitive draw.

Category creation offers **Round-robin groups** or **Single elimination**. Scoring and singles/doubles selection remain independent of the tournament format.

## Dynamic groups

Round-robin categories specify a target group size, defaulting to four entries. Group count is computed from actual entries, capped at the existing 64-group limit and reduced as needed to keep every group playable and accommodate qualifier places. Sizes differ by at most one entry. Qualifier places are capped to the available entries when registration closes. Seeds remain distributed before unseeded entries are shuffled.

Examples with target group size four and one qualifier per group:

| Confirmed entries | Groups | Sizes |
| --- | --- | --- |
| 3 | 1 | 3 |
| 5 | 2 | 3, 2 |
| 7 | 2 | 4, 3 |
| 9 | 3 | 3, 3, 3 |

The circle rotation creates every unordered pair in a group exactly once. An odd group has one resting entry per round, and each entry rests once across the full cycle. A rest is not an elimination advancement or scored win. Only two real opponents form a match. `matches.group_round` records the rotation round; the committee continues to assign actual courts and times separately.

## Elimination

The number of bracket places is `2 ^ ceil(log2(N))`, where N is the actual eligible entry count. The bracket needs `places - N` byes. Recipients are sampled without replacement using a Fisher–Yates shuffle, including seeded entries; seed rank does not automatically award a bye. Remaining entries retain their seed order for opening pairings, and bye positions are shuffled. Later rounds combine their two preceding pairings.

| Entries | Places | Byes | Real matches to a champion |
| --- | --- | --- | --- |
| 3 | 4 | 1 | 2 |
| 5 | 8 | 3 | 4 |
| 6 | 8 | 2 | 5 |
| 7 | 8 | 1 | 6 |
| 9 | 16 | 7 | 8 |

A bye is explicit bracket metadata (`bye_player_id`) with no opponent and no match ID. Publication automatically advances it. It never creates a fake profile, walkover, game, match win, ranking point or participation credit. A downstream match is created exactly once when both participants are known from byes or finalized source results. Every saved match contains two different real entries, and an N-entry elimination finishes with N−1 matches.

Direct elimination uses all confirmed entries and skips group matches. After round-robin groups, knockout uses the actual qualified entries from published standings, rather than assuming a fixed-size field. Qualification-boundary ties remain blocked for resolution. Power-of-two fields retain the existing first-versus-last seeded crossover.

## Review, locking and history

The server counts the roster, and guarded database functions independently verify it under the category lock on saving and publishing. Seeds and first-round participants must cover exactly the eligible field. The validator rejects duplicate entries, invented bye winners, pre-filled future opponents, existing match IDs, incorrect round sizes and invalid source links. An unpublished elimination proposal can be regenerated or cancelled before reopening registration. Published draws cannot be regenerated.

Existing published fixtures/brackets are not rewritten. Historical fixtures may have no group round value. The migration skips group-size backfills for completed/archived categories and terminal parent tournaments so their existing read-only guards remain intact.

## Installation and verification

Apply `supabase/migrations/20261108164632_dynamic_draws_and_byes.sql` after all earlier migrations. The application reports missing setup until `dynamic_draw_capability()` is available. Existing RPC grants are retained; new mutation functions require authenticated MT/administrator authority and have restricted execute grants. Client code cannot write the new draw configuration fields directly.

`tests/dynamic-draw.test.ts` checks odd/even field sizes, random bye selection, balanced grouping and round-robin uniqueness. `tests/dynamic-draw-database.test.ts` replays the migrations and verifies real publication, score submission, advancement through the final, doubles partners, ranking counts, stale roster rejection, cancelling/reopening and upgrades with completed history. Tests use isolated PostgreSQL (PGlite), without changing hosted data.
