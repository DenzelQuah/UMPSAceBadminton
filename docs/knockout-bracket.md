# Knockout bracket rules

The bracket uses the actual eligible field, expanding to the next power of two with randomly selected byes. Direct elimination uses confirmed entries after registration closes; group-stage knockout uses actual qualifiers. Fields of two or more entries are supported. See [dynamic draws and byes](dynamic-draws.md) for the current rules.

## Seed order

Qualifiers are ordered by group position:

1. Winner from each group, in group order.
2. Runner-up from each group, in group order.
3. Additional qualifier positions, in group order.

The first round pairs the first seed with the last seed, the second with the second-last, and so on. Later rounds combine adjacent pairings.

For four groups with two qualifiers each:

- QF1: A1 vs D2
- QF2: B1 vs C2
- QF3: C1 vs B2
- QF4: D1 vs A2
- SF1: QF1 vs QF2
- SF2: QF3 vs QF4
- Final: SF1 vs SF2

The same seeded construction is used for larger power-of-two brackets, such as eight groups with two qualifiers each (16-player bracket). When byes are needed, recipients are sampled without replacement from the actual field. They advance without a scored match; later rounds continue to use adjacent source pairings.

## Review and ties

The administrator must review the proposal before publishing. If the qualification boundary has an unresolved tie, generation is blocked rather than applying an unapproved tie-break rule.
