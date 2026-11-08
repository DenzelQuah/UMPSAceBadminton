# Full-flow test rehearsal

This is a disposable development rehearsal for the connected Supabase project. It uses real Auth accounts and real RLS/RPC authorization. It must not be enabled in production.

## Personas

The local login page exposes these buttons when both test-mode flags are enabled:

- Administrator
- Player 01–04
- MT (uses the former Umpire credentials until `TEST_MT_*` is configured)
- EXCO (uses the former Linesman credentials until `TEST_EXCO_*` is configured)
- AJK (optional `TEST_AJK_*` credentials)

The server reads the account credentials from ignored environment variables. Passwords are never stored in this repository or printed by the app.

The Administrator test button verifies `profiles.is_admin = true` after sign-in. Its label does not grant privileges. If the documented `codex-test-admin@umpsa.edu.my` account was recreated and now has ordinary player access, the project owner can review and run `scripts/restore-test-admin.sql` in the Supabase SQL Editor. That script updates only this account and records an audit entry. It does not change tournament data. Sign out and sign in again after restoring access.

## Fixture

After the Auth users exist, run `scripts/activate-test-accounts.sql` from the Supabase SQL Editor. It assigns the disposable profile roles and creates the fixture. `scripts/seed-full-flow-test.sql` can be used when the Auth users already have the correct roles.

The fixture is prefixed with `Codex Full Flow` and starts with one draft singles category. It intentionally has no registrations so the player registration step remains part of the test.

## Walkthrough

1. Sign in as **Administrator**.
2. Open Role approvals, approve the pending MT and EXCO test requests, and approve an AJK request if an AJK test account is configured. Open the `Codex Full Flow` tournament workspace.
3. Open registration for the test category.
4. Switch to **Player 01**, register, then repeat for Players 02–04.
5. Switch back to **Administrator**.
6. Assign seeds, close registration, and generate a private preview.
7. Review the preview and explicitly publish it.
8. As approved **MT** or Administrator, schedule matches and assign approved EXCO/AJK members as umpire and linesman.
9. Switch to the **EXCO** or **AJK** account assigned as umpire and open its court. Start and score the match through submission. A linesman assignment must remain read-only.
10. Switch to **Administrator** to review the result, complete the tournament, and archive it if desired.
11. Repeat the public player view with a published category to confirm RLS visibility.

## Doubles and workspace rehearsal

1. Apply the doubles migration after all prior migrations, then sign in with one approved administrator account. Verify the workspace chooser offers Administration, Player and Official.
2. Create a doubles category and open registration. Mark Player 01 and Player 02 as main squad in this tournament's squad roster.
3. As Player 01, verify an invitation to Player 02 is rejected. Invite non-main-squad Player 03 instead.
4. As Player 03, open the same tournament, accept, and verify both users see one confirmed pair (or one waitlist entry if capacity is full).
5. Verify an unrelated user cannot accept the invitation. Verify either partner can withdraw before registration closes and cannot withdraw afterward.
6. Register another eligible pair, close registration, publish the draw and verify both names appear on each side. Check that either partner's competing match or official duty prevents conflicting scheduling.
7. As a linesman, verify Official duties are available and the assignment has no scoring link. As the assigned umpire, score and submit the match. As administrator, complete the tournament and verify both partners receive the side's earned ranking points.
8. For knockout rehearsal use at least eight pair entries and follow the reviewed bracket through the final.

## Cleanup

After the rehearsal, delete the disposable Auth users and the `Codex Full Flow` tournament from the Supabase Dashboard. Verify that no `Codex Full Flow` rows remain and remove the test-mode variables from `.env.local`.

Do not use these accounts or fixture records for a real tournament.
