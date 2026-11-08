# Seeded Player Distribution Algorithm

## Objective

Distribute seeded players across groups so that each group
contains at most one seeded player whenever the number of
seeded players does not exceed the number of groups.

## Input

- Group count derived from confirmed entries and target group size (see [dynamic draws](dynamic-draws.md))
- Registered players
- Seeded players

## Rules

1. Each seeded player must belong to exactly one group.
2. Each group should contain one seeded player if possible.
3. Two seeded players should never be placed in the same group
   when an empty group exists.
4. Remaining non-seeded players should be randomly distributed.
5. Groups should have balanced player counts.
6. A player cannot appear in more than one group.

## Example

Groups = 8
Seeded Players = 8

Result:

Group A → Seed 1
Group B → Seed 2
Group C → Seed 3
Group D → Seed 4
Group E → Seed 5
Group F → Seed 6
Group G → Seed 7
Group H → Seed 8
