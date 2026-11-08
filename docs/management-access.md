# Management access and application visibility — 9 November 2026

MT and administrators retain the focused `/mt` dashboard, the complete `/admin` management workspace, tournament creation, and `/admin/tournaments/<id>` for category/roster/draw/schedule/official management. Home and the global side menu expose both management destinations. `/mt` also links to the complete workspace, without duplicating its operational UI.

## One approved-role resolver

`lib/auth/organizational-roles.ts` normalizes approved database `organizational_role`, `user_role`, and legacy `role` fields. MT and Admin labels are case-insensitive. Admin/Administrator/Platform_Admin aliases resolve to SYSTEM_ADMIN. An explicit `is_admin` flag remains supported. Request metadata, signup selections and role labels on test login buttons grant no authority.

`readActorProfile` normalizes the authoritative RPC response before capabilities are computed. The dashboard, side menu, proxy and server-action guards use those same capabilities. The restoration migration imports existing trusted legacy profile role columns into the approved flags, protects those columns from client writes, and keeps approved profile roles effective when global role rows or the role-table migration are missing. Existing global role-table grants also remain recognized.

Players and AJKs may still apply through the existing flow. **MT, EXCO and System Admin users see neither the organization application widget nor tournament AJK application widget.** Home and tournament detail pages skip those users' application-data requests. A failed/missing profile does not default to showing lower-role forms. EXCO does not gain tournament management rights from having its application widgets hidden. Administrator approval/revocation remains separately protected.

## Confirmed backup manager

The owner selected `prodenzel992@gmail.com`. The login/registration domain exception admits that exact address only; other Gmail accounts and lookalike/plus-address variants remain excluded. The database signup trigger and profile email constraint contain the same exception.

After `20261108180005_restore_management_access.sql` is installed, the exact **verified Supabase Auth email** has System Admin/MT bypass. This works for newly registered accounts and existing Auth records, including a missing profile from an older setup. The migration reconciles ADVISOR grants without changing Auth records or setting a permanent profile administrator flag. Profile email and editable user metadata cannot supply this privilege. Changing the Auth email or removing confirmation removes the bypass immediately; separately granted permanent administrator access remains independent.

Apply the restoration migration after the earlier migrations, as listed in README. This final migration replaces the original historical NULL advisor constant. The application visibility/navigation fix works for existing approved MT/admin/EXCO profiles independently; the Gmail exception's backend authorization needs the database update. The account must use normal signup/sign-in and email verification.

## Verification

`tests/management-visibility.test.ts` covers role aliases, management destinations and hidden lower-role applications. `tests/management-access-database.test.ts` covers actual management writes, legacy-role upgrades, missing role rows/table, exact verified advisor bypass, approval rights, spoofed/unverified email rejection, signup restrictions and privilege-write denial. HTTP checks against the running app verify MT/admin management routes, EXCO/player redirects and role-specific application widgets without altering hosted data.
