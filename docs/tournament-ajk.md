# Tournament AJK approvals — 9 November 2026

This extension supersedes older statements that all AJK approvals require a platform administrator. Organization-wide MT/EXCO/legacy AJK appointments still require a System Admin. **Tournament-specific AJK applications may be approved or rejected by an approved MT or System Admin.**

## Roles and scope

- `roles` is the role catalog: PLAYER, AJK, EXCO, UMPIRE, LINESMAN, MT, SYSTEM_ADMIN.
- `user_roles` maps a person to roles. Organization roles have no tournament or match scope. An AJK application grant has a tournament ID. Umpire/linesman duties include both tournament and match IDs.
- Every person retains PLAYER. Approval does not prevent competing. Existing self-officiating, conflict, rest-buffer and scoring checks continue to apply.
- The existing approved `profiles.is_admin` and `organizational_role` fields synchronize into global role rows through a protected trigger. This preserves administrator approvals and existing management RPCs during the transition. Clients cannot write role rows or profile privilege fields.
- Match assignments synchronize UMPIRE/LINESMAN rows through a protected trigger. A duty row never replaces eligibility checks: its holder must also have an approved global staff role, the matching tournament AJK appointment, or System Admin access. Reassigning a duty removes its old row.
- A tournament AJK grant never changes `profiles.organizational_role`, grants MT access, or makes the person eligible in another tournament.

## Player flow

On `/dashboard` or a tournament's detail page, select a published tournament and choose **Apply as AJK**. The authenticated database operation supplies the applicant ID from the session. Duplicate requests retain one active application per person per tournament. Private drafts and ended tournaments reject applications.

Pending requests grant no privileges. An approved application writes a scoped AJK role in the same transaction as its audit record. `current_user_access()` returns the effective `user_role`, tournament AJK IDs, and eligible match duties. Home and the account menu display `(AJK)` before the person's name when their effective role is AJK. The stored name is unchanged. Rejected applicants remain players and can apply again while the tournament is open.

## MT Dashboard

`/mt` is available to approved MT and System Admin accounts. It contains only:

1. Pending AJK table: player, tournament, application date, Approve and Reject.
2. Create tournament and a basic list linking to existing tournament management.

The server and database both verify authority. Self-review is prohibited. An application can be decided only once; stale decisions do not overwrite the previous decision. Organization appointment/revocation tools remain separately at `/admin/users` for System Admins.

## Advisor / backup manager

`private.backup_manager_email()` is the database-owned email constant. The owner confirmed **prodenzel992@gmail.com** on 9 November 2026. Apply `20261108180005_restore_management_access.sql` after the earlier migrations to configure the address, allow its normal signup/login, and reconcile an already registered verified account. The original role-table migration's NULL constant remains historical; do not edit applied migrations or enable a domain-wide Gmail bypass. Management authority requires this exact verified Supabase Auth address, never a profile email or signup metadata.

A matching **verified Supabase Auth email** receives a SYSTEM_ADMIN grant with source ADVISOR, on profile creation or Auth updates. This account can use MT approvals and tournament management without an MT appointment, and can review organization appointments. Profile emails and user-editable metadata cannot grant this access. Every privileged check revalidates the advisor email and confirmation against Auth. Changing the email removes the bypass; the profile's permanent administrator flag is never set by this exception. Ordinary manually approved administrators retain their independent global grants.

## Installation and validation

Run `20261108162756_tournament_ajk_applications.sql` after `20261106184015_organizational_role_approvals.sql` and all earlier migrations. New tables have RLS and explicit authenticated SELECT grants; all writes use guarded RPCs or internal triggers with restricted execution. Anonymous access to applications and role grants is denied. Older hosted databases retain existing workspaces but show a setup message for the new feature until installed.

`tests/tournament-ajk.test.ts` replays every migration against isolated PostgreSQL (PGlite), checking role escalation, applicant privacy, pending/approved/rejected states, duplicate submissions and decisions, self-review, event scope, roster filtering, scoring duties, advisor verification/email changes, audit rollback, and anonymous access. These tests do not alter the hosted project. Hosted migration application and Supabase advisor checks require the project owner's database connection.
