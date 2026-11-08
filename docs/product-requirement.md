# UMPSAce Badminton - Product Requirements

**Document Version:** 1.0  
**Project:** UMPSAce Badminton  
**Platform:** Web Application  
**Primary Institution:** Universiti Malaysia Pahang Al-Sultan Abdullah (UMPSA)

---

# 1. Product Overview

UMPSAce Badminton is a tournament management platform designed to help UMPSA badminton tournament organizers manage the tournament lifecycle from player registration to tournament completion.

The system aims to reduce manual tournament administration by automating and centralizing:

- Tournament creation
- Player registration
- Player grouping
- Seeded player distribution
- Automated tournament draws
- Group-stage match generation
- Match scheduling
- Court allocation
- Umpire and linesman assignment
- Live match scoring
- Match result recording
- Group standings calculation
- Knockout bracket progression
- Tournament notifications
- Player tournament history
- Player ranking

The system should provide different experiences for:

- Organizer
- Player
- Official

An authenticated User account may have multiple capabilities or roles.

For example, one person may participate in the system as:

- Player in one tournament
- Umpire for another match
- Linesman for another match

The system should therefore allow the same User account to perform different functions depending on their current assignment and permissions.

---

# 2. Product Goals

The main goals of UMPSAce are:

1. Reduce manual tournament administration.
2. Automate tournament player grouping.
3. Ensure seeded players are distributed fairly.
4. Provide players with clear and accessible match schedules.
5. Allow umpires to record live match scores digitally.
6. Automatically calculate tournament standings.
7. Automatically determine qualified players.
8. Automatically progress qualified players through knockout stages.
9. Provide tournament officials with centralized management tools.
10. Prevent scheduling conflicts between players, officials, and courts.
11. Provide players with tournament history and ranking information.
12. Improve the overall tournament experience for UMPSA badminton events.
13. Provide a scalable foundation for future tournament categories and sports.

---

# 3. Product Scope

## 3.1 Initial Product Scope

The initial version of UMPSAce should focus on badminton tournament management.

The first version should prioritize:

- Singles tournament management
- Player registration
- Tournament creation
- Seeded player management
- Automated group draw
- Group-stage management
- Match scheduling
- Umpire and linesman assignment
- Live scoring
- Group standings
- Knockout progression
- Notifications
- Tournament history
- Player ranking

---

## 3.2 Future Scope

Future versions may expand support to:

- Men's Doubles
- Women's Doubles
- Mixed Doubles
- Additional tournament formats
- Other sports
- Courtside QR check-in
- Automated court re-allocation
- Advanced tournament analytics

The system architecture should allow future expansion without unnecessarily complicating the initial version.

---

# 4. User Types and Capabilities

UMPSAce should support the following main user types:

1. Organizer
2. Player
3. Official

An Official may perform one or more tournament assignments:

- Umpire
- Linesman

A User may have multiple capabilities.

For example:

User A may be:

- Player
- Official

During Tournament A:

- User A is assigned as Umpire for Match 1.

During Tournament B:

- User A is assigned as Linesman for Match 5.

The system should not require separate accounts for Umpire and Linesman assignments.

---

# 5. Authentication Requirements

## 5.1 Development and Debugging Stage

During development and debugging, the system should support:

- Google authentication
- Email and password registration
- Email and password login

The development environment may use test accounts for development purposes.

Authentication restrictions should be configurable so that development testing is not blocked by production-only domain restrictions.

---

## 5.2 Production Authentication

During production deployment, registration and login should be restricted to authorized UMPSA email domains.

The intended domains are:

- `@adab.umpsa.edu.my`

The exact relationship between student and staff domains should be configurable.

For example:

- `@adab.umpsa.edu.my` → Student / Player

The final domain policy should be confirmed before production deployment.

Domain validation must be performed securely on the server side.

Users should not be able to bypass domain restrictions by modifying frontend requests.

---

# 6. Organizer Requirements

The Organizer is responsible for managing tournaments and controlling tournament progression.

Organizers should be able to:

- Create tournaments
- Edit tournament settings
- Create tournament categories
- Configure tournament rules
- Configure scoring formats
- Configure registration settings
- Configure player capacity
- Manage player registration
- Manage waitlists
- Select seeded players
- Start automated tournament draws
- Preview generated draws
- Regenerate draws before publication
- Publish official draws
- Configure courts
- Assign officials
- Manage match schedules
- Monitor live matches
- View tournament standings
- Manage tournament progression
- View match results
- Override completed match results when authorized
- Manage disputes
- View feedback
- Complete tournaments
- View tournament history

---

# 7. Tournament Creation

Organizers should be able to create a tournament.

A tournament should contain information such as:

- Tournament name
- Tournament description
- Tournament location
- Tournament start date
- Tournament end date
- Registration opening date
- Registration closing date
- Number of available courts
- Tournament categories
- Maximum player capacity
- Number of groups
- Number of qualifiers per group
- Scoring format
- Match format
- Tournament status

---

# 8. Tournament Categories

A tournament may contain multiple independent categories.

Examples include:

- Men's Singles
- Women's Singles
- Men's Doubles
- Women's Doubles
- Mixed Doubles

Each category should have its own:

- Player pool
- Registration list
- Seeded players
- Draw
- Groups
- Matches
- Standings
- Knockout bracket
- Results
- Ranking calculation

The initial MVP may support Singles categories first.

Doubles support may be introduced in a future version.

---

# 9. Tournament Status

A tournament or tournament category should have controlled lifecycle states.

Possible statuses include:

- Draft
- Registration Open
- Registration Closed
- Draw Preparation
- Draw Generated
- Draw Published
- Group Stage In Progress
- Group Stage Completed
- Knockout Stage In Progress
- Completed
- Archived

The system should prevent invalid status transitions.

For example:

A tournament should not enter the Group Stage before the official draw has been published.

---

# 10. Tournament Registration

Players should be able to view tournaments that are open for registration.

Players should be able to register for a tournament category after authentication.

The registration process should:

1. Verify that the user is authenticated.
2. Verify that the tournament is open for registration.
3. Verify that the user is eligible.
4. Verify that the user has not already registered.
5. Verify that the category has available capacity.
6. Create the tournament registration.

A player must not be able to register for the same tournament category more than once.

---

# 11. Capacity and Waitlist

Organizers should be able to configure the maximum number of players for each category.

Example:

Men's Singles:

- Maximum players: 32

If the category reaches capacity:

- New eligible players should be placed on a waitlist.
- Waitlist entries should record their registration timestamp.
- The system should preserve the waitlist order.

If a registered player withdraws before registration closes, the Organizer may promote the next eligible player from the waitlist.

The exact waitlist promotion rules should be defined in the tournament rules.

---

# 12. Player Requirements

Players should be able to:

- Authenticate using an authorized account.
- View available tournaments.
- View tournament details.
- Register for tournaments.
- Join tournament categories.
- View registration status.
- View tournament draws.
- View their assigned group.
- View group standings.
- View upcoming matches.
- View opponent information.
- View court information.
- View scheduled match time.
- View estimated match time.
- View match history.
- View completed match results.
- View knockout brackets.
- View tournament winners.
- View tournament history.
- View player ranking.
- Receive tournament notifications.
- Contact tournament organizers.
- Submit feedback.

Players should not be able to modify official match results.

---

# 13. Player Dashboard

The Player Dashboard should provide a personalized view of the player's tournament activities.

The dashboard should display:

- Registered tournaments
- Upcoming matches
- Match date
- Match time
- Estimated start time
- Court number
- Opponent
- Match status
- Current group position
- Tournament progress
- Recent match results
- Tournament history
- Notifications

---

# 14. Organizer-Triggered Automated Draw

The automated draw is a core feature of UMPSAce.

The Organizer must manually trigger the automated draw.

The system must not automatically start the draw without explicit Organizer action.

The Organizer should follow this process:

1. Close player registration.
2. Confirm registered players.
3. Confirm tournament category.
4. Configure the number of groups.
5. Select seeded players.
6. Confirm tournament draw settings.
7. Click "Start Automated Draw".
8. System validates the tournament.
9. System generates the draw.
10. Organizer previews the draw.
11. Organizer may regenerate the draw if necessary.
12. Organizer publishes the final draw.
13. Published draw becomes the official tournament draw.

---

# 15. Automated Draw Validation

Before generating a draw, the system should validate:

- Registration is closed.
- The tournament has enough registered players.
- The number of groups is valid.
- The number of players can be distributed across the groups.
- Seeded players are registered.
- Seeded players are not duplicated.
- All registered players are valid.
- No player appears more than once in the registration list.

If validation fails, the system should prevent the draw from starting.

The system should display a clear error message explaining the problem.

---

# 16. Seed Management

Organizers should be able to designate registered players as seeded players.

The Organizer should be able to:

- View all registered players.
- Select seeded players.
- Assign seed numbers.
- Edit seed numbers.
- Remove a player from the seeded list.

Example:

- Seed 1 → Player A
- Seed 2 → Player B
- Seed 3 → Player C

The system must prevent:

- Duplicate seed numbers.
- The same player having multiple seed numbers.
- Unregistered players from being seeded.

Seed selection must be completed before the automated draw is started.

---

# 17. Seeded Player Distribution

The automated draw should distribute seeded players fairly across groups.

The preferred rule is:

Each group should receive one seeded player when possible.

For example:

8 groups:

- Group A → Seed 1
- Group B → Seed 2
- Group C → Seed 3
- Group D → Seed 4
- Group E → Seed 5
- Group F → Seed 6
- Group G → Seed 7
- Group H → Seed 8

If there are more seeded players than groups, additional seeded players should be distributed using the configured seeding algorithm.

The system should avoid placing multiple seeded players in the same group when another group has no seeded player.

The exact algorithm should be defined in:

`docs/seeding-algorithm.md`

---

# 18. Unseeded Player Distribution

After seeded players have been distributed, the remaining players should be distributed randomly across available group slots.

The system should ensure:

- Every player is assigned exactly once.
- No player appears in multiple groups.
- No player is omitted.
- Groups are balanced as evenly as possible.
- The distribution is sufficiently randomized.

The exact randomization algorithm should be defined in:

`docs/seeding-algorithm.md`

---

# 19. Draw Preview

After the automated draw has been generated, the Organizer should be able to preview the result.

The preview should display:

- Group names
- Players in each group
- Seeded players
- Seed numbers
- Number of players in each group

The Organizer should be able to:

- Publish Draw
- Regenerate Draw
- Cancel Draw

The draw should not become visible to players until it has been published.

---

# 20. Draw Publication

Once the Organizer publishes the draw:

- The draw becomes the official tournament draw.
- Players can view their group.
- Players can view the tournament grouping.
- Group-stage matches can be displayed.
- Match schedules can be generated or finalized.

The system should record:

- Who published the draw.
- When the draw was published.
- The final draw configuration.

Published draws should be protected from unauthorized modification.

Any changes after publication should require Organizer authorization and should be recorded in an audit trail.

---

# 21. Group Stage

The system should support group-stage tournaments.

Each group should contain:

- Group name
- Registered players
- Seeded players
- Matches
- Match results
- Standings

The default group-stage format should be round-robin.

Every eligible player in a group should play against the other players in that group according to the configured tournament rules.

---

# 22. Round-Robin Match Generation

The system should automatically generate group-stage match pairings.

For example, a four-player group:

- Player A vs Player B
- Player A vs Player C
- Player A vs Player D
- Player B vs Player C
- Player B vs Player D
- Player C vs Player D

The system should prevent:

- Duplicate pairings.
- A player playing themselves.
- Missing required pairings.

The exact round-robin generation logic should be defined in the tournament rules and technical specifications.

---

# 23. Group Standings

The system should automatically calculate group standings after completed match results are confirmed.

The standings table should display:

- Pld — Matches Played
- W — Matches Won
- L — Matches Lost
- PW — Points Won
- PL — Points Lost
- NP — Net Points
- Pts — Standings Points

Net Points should be calculated as:

`NP = PW - PL`

The standings should update automatically after a completed match result is confirmed.

---

# 24. Group Ranking and Tie-Breaking

The current intended ranking priority is:

1. Standings Points
2. Net Points
3. Head-to-Head Result

If two or more players have the same number of Standings Points, the system should compare their Net Points.

The player with the higher Net Points should rank higher.

If Net Points are also equal, the system should evaluate the configured Head-to-Head rule.

The exact tie-breaking logic should be documented in:

`docs/tournament-rules.md`

and implemented according to:

`docs/tournament-engine-specification.md`

If the tie cannot be resolved by the configured rules, the system should flag the situation for Organizer review instead of silently selecting a winner.

---

# 25. Match Management

Each match should contain:

- Match ID
- Tournament
- Category
- Group or Knockout Round
- Player / Team A
- Player / Team B
- Match status
- Scheduled date
- Scheduled time
- Estimated start time
- Court
- Umpire
- Linesman
- Game results
- Final winner

Possible match statuses include:

- Scheduled
- Ready
- In Progress
- Completed
- Cancelled
- Postponed

---

# 26. Match Scoring

The system should support configurable scoring formats.

Initial supported formats may include:

### Standard Set

Best of 3 games/sets.

Each game is played to 21 points.

The game may extend according to official badminton rules, with a maximum of 30 points.

A 2-minute interval should be triggered when the first side reaches 11 points.

### Single Set

One game/set to 30 points.

A 2-minute interval should be triggered when the first side reaches 15 points.

### Configurable Formats

The system should be designed so that additional scoring formats can be added in the future.

The exact badminton scoring rules should be defined in:

`docs/match-rules.md`

---

# 27. Umpire Requirements

An assigned Umpire should be able to:

- View assigned matches.
- View court information.
- View player information.
- Start a match.
- Record live scores.
- Add points.
- Correct incorrectly entered points.
- View current scores.
- Record warnings.
- Record Yellow Cards.
- Record Red Cards or other disciplinary actions if supported by the tournament rules.
- Record interruption notes.
- Start interval timers.
- End interval timers.
- Confirm game completion.
- Confirm match completion.
- Submit the final result.

---

# 28. Umpire Live Scoring Interface

The Umpire scoring interface should be optimized for:

- Mobile phones
- Tablets
- Touch interaction
- Bright indoor sports environments

The interface should provide:

- Large touch targets.
- Clear score display.
- Player names.
- Current game/set number.
- Match status.
- Point controls.
- Undo/correction controls.
- Interval timer.
- Match point indicator.
- Deuce indicator.
- Warning and disciplinary controls.

The system should automatically evaluate the current match rules and display appropriate status indicators.

---

# 29. Match Verification

Before an Umpire submits the final match result:

- The final score must be displayed clearly.
- The winner must be identified.
- The Umpire must confirm the result.

The Umpire should perform a digital confirmation/sign-off.

Once the match is marked as Completed:

- The official score becomes locked for the Umpire.
- The result cannot be modified by the Umpire.
- Only an authorized Organizer may override the result.

Any Organizer override must be recorded in an audit trail.

---

# 30. Official Role and Assignments

A User may act as an Official.

An Official may be assigned to:

- Umpire a match.
- Act as Linesman for a match.

The same User may have different assignments at different times.

The system should provide an Official interface that displays current assignments.

The interface should allow the Official to access the appropriate mode based on the assignment:

- Umpire Mode
- Linesman Mode

---

# 31. Linesman Requirements

A Linesman should be able to:

- View assigned matches.
- View assigned court.
- View scheduled match time.
- View Player A.
- View Player B.
- View the assigned Umpire.
- View match status.
- Check in at the assigned court.

The Linesman should not be able to modify the official match score.

---

# 32. Official Assignment

Organizers should be able to assign officials to tournament matches.

The system may support:

- Individual match assignments.
- Court-based assignments.
- Time-slot assignments.

The assignment method should be configurable based on tournament needs.

The system should prevent an Official from being assigned to conflicting duties.

For example:

A User should not be assigned as an Umpire for a match while simultaneously playing another match at the same time.

A User should not be assigned as a Linesman for a match while simultaneously playing another match at the same time.

The system should detect assignment conflicts automatically.

---

# 33. Court Management

Organizers should be able to configure available courts.

Example:

- Court 1
- Court 2
- Court 3
- Court 4
- Court 5
- Court 6

The scheduling system should prevent two matches from occupying the same court at the same time.

---

# 34. Match Scheduling

The scheduling engine should assign matches to available courts and time slots.

The scheduling engine must prevent:

1. A player being scheduled for two matches at the same time.
2. A player having insufficient rest between matches.
3. An Umpire being assigned to two simultaneous matches.
4. A Linesman being assigned to two simultaneous matches.
5. A court hosting two simultaneous matches.
6. An Official being assigned to a match while playing another match.

The system should support a configurable minimum player rest period.

Example:

`Minimum rest period = 20 minutes`

The exact scheduling algorithm should be defined separately.

---

# 35. Match Schedule Display

Players should be able to view:

- Match date
- Match time
- Estimated start time
- Court
- Opponent
- Match status

Umpires should be able to view:

- Assigned match
- Court
- Scheduled time
- Players

Linesmen should be able to view:

- Assigned match
- Court
- Scheduled time
- Players
- Assigned Umpire

Organizers should be able to view the complete tournament schedule.

---

# 36. Realtime Match Updates

The system should support near-real-time match updates.

When an Umpire records a score:

1. The score is saved securely.
2. The system broadcasts the update.
3. Authorized clients receive the update.
4. The score display updates without requiring a full page refresh.

Potential viewers include:

- Organizer dashboard
- Public tournament display
- Player dashboard
- Spectator-facing displays, if supported

The system should use Supabase Realtime or an equivalent realtime technology.

The system should aim for near-real-time synchronization.

The exact performance target should be validated through testing rather than treated as an absolute guarantee.

---

# 37. Knockout Stage

After all required group-stage matches are completed, the system should automatically determine qualified players.

The number of qualifiers per group should be configurable according to tournament rules.

The system should then generate the appropriate knockout bracket.

Possible knockout rounds include:

- Round of 16
- Quarterfinals
- Semifinals
- Finals

The exact bracket structure depends on:

- Number of groups
- Number of qualifiers
- Tournament format

---

# 38. Knockout Crossover Logic

The system should support configurable crossover rules.

For an eight-group tournament where one player qualifies from each group, an example crossover may be:

- Winner Group A vs Winner Group H
- Winner Group B vs Winner Group G
- Winner Group C vs Winner Group F
- Winner Group D vs Winner Group E

The system should support additional crossover configurations when required.

The final crossover rules should be defined in:

`docs/tournament-rules.md`

The system should prevent invalid or duplicate knockout pairings.

---

# 39. Knockout Bracket Advancement

When a knockout match is completed:

1. The winner is confirmed.
2. The result is recorded.
3. The winner advances to the next bracket position.
4. The next match becomes available when its required participants are known.

The UI should visually display bracket progression.

Example:

`Quarterfinal → Semifinal → Final → Champion`

The final tournament winner should be displayed prominently after the final match is completed.

---

# 40. Player Ranking System

UMPSAce should provide a global UMPSA player ranking system.

Players should accumulate ranking points based on tournament performance.

Example ranking points:

- Winner → 1000 points
- Runner-up → 800 points
- Semifinalist → 600 points

The ranking system should be configurable.

The ranking system may consider:

- Tournament finishing position
- Tournament category
- Tournament importance
- Number of tournaments
- Ranking points earned
- Ranking points retained or expired

The exact ranking calculation should be defined in:

`docs/ranking-system.md`

The ranking system should maintain historical ranking data.

---

# 41. Tournament History

Users should be able to browse completed tournament history.

Users should be able to filter tournaments by:

- Year
- Month
- Tournament
- Category

Historical tournament information may include:

- Tournament name
- Tournament date
- Category
- Winner
- Runner-up
- Finalists
- Final score
- Historical bracket
- Group-stage results
- Final standings

Past tournament results should remain available as an archive.

---

# 42. Notifications

The system should provide notifications for important tournament events.

Notifications may include:

### T-24 Hours

Players receive a notification containing their next-day schedule.

The notification may include:

- Tournament name
- Match opponent
- Match time
- Estimated start time
- Court

### Upcoming Match

The system may notify players when their match is approaching.

### Match Call

The Organizer or authorized official may broadcast an alert such as:

"Match #14: Player A vs Player B. Please proceed to Court 3."

### Schedule Changes

Players and affected officials should be notified when a match schedule changes.

### Draw Published

Players should be notified when the official tournament draw is published.

---

# 43. Dispute Resolution

The system should provide a basic dispute or issue reporting mechanism.

Umpires or authorized officials should be able to escalate:

- Code-of-conduct violations
- Match disputes
- Player issues
- Scheduling problems
- Other tournament incidents

The Organizer should be able to view and manage submitted issues.

Each issue may contain:

- Reporter
- Tournament
- Match
- Description
- Timestamp
- Status
- Organizer response

---

# 44. Feedback System

After a tournament, players should be able to submit feedback.

Feedback may cover:

- Tournament organization
- Scheduling
- Umpiring
- Facilities
- System usability
- Suggestions for improvement

The Organizer should be able to review aggregated feedback.

---

# 45. Data Integrity and Audit Trail

The system should protect important tournament data.

Once a match is marked as Completed:

- Umpires cannot modify the official result.
- Players cannot modify the official result.
- Linesmen cannot modify the official result.

Only authorized Organizers may override completed results.

Every override should record:

- User who performed the override
- Original result
- New result
- Reason for change
- Timestamp

Important tournament actions should also be auditable.

Examples:

- Draw generated
- Draw regenerated
- Draw published
- Match result submitted
- Match result overridden
- Tournament completed

---

# 46. Non-Functional Requirements

## 46.1 Technology Stack

The initial system should be built using:

- Next.js with App Router
- TypeScript
- Tailwind CSS
- Supabase
- PostgreSQL
- Supabase Authentication
- Supabase Realtime

Additional libraries may be introduced when necessary and approved by the project architecture.

---

## 46.2 Responsive Design

The application should be responsive and optimized for:

- Desktop
- Tablet
- Mobile phone

The Umpire scoring interface must prioritize mobile and tablet usage.

The interface should provide:

- Large touch targets
- Clear typography
- High contrast
- Minimal navigation complexity
- Fast access to scoring controls

---

## 46.3 Performance

The application should provide responsive interactions.

Realtime score updates should be delivered with low latency.

The system should aim for near-real-time score synchronization across connected clients.

Performance targets should be verified through testing under realistic network conditions.

---

## 46.4 Security

The system should implement:

- Authentication
- Role-based access control
- Server-side authorization
- Domain validation
- Secure database access
- Protected API endpoints
- Audit logging for sensitive actions

Users must not be able to access Organizer functionality by modifying frontend requests.

Authorization must be enforced server-side.

---

## 46.5 Data Integrity

The system must maintain tournament data consistency.

The system must prevent:

- Duplicate registrations
- Duplicate group membership
- Duplicate match pairings
- Duplicate court assignments
- Conflicting official assignments
- Invalid tournament progression
- Invalid match results
- Unauthorized score modification

---

# 47. Future Considerations

## 47.1 Courtside QR Check-In

The system may generate dynamic QR codes for physical courts.

Players could scan a QR code approximately 10 minutes before their match to confirm attendance.

---

## 47.2 Automated Court Re-Allocation

If a match finishes earlier than expected, the system may suggest moving the next scheduled match forward.

Example:

Court 1 finishes a match 30 minutes earlier than expected.

The system may suggest:

- Moving the next match forward.
- Notifying affected players.
- Updating the schedule.
- Updating the assigned officials.

The Organizer must approve the change before it becomes official.

---

## 47.3 Additional Sports

Future versions may expand beyond badminton to support other sports.

The architecture should avoid unnecessary hard-coding of badminton-specific concepts where future expansion is reasonably foreseeable.

---

# 48. Requirements Requiring Further Definition

The following requirements must be finalized before the Tournament Engine is implemented:

1. Exact number of players per group.
2. Whether group sizes must always be equal.
3. Exact number of qualifiers per group.
4. Exact group-stage scoring points system.
5. Exact tie-breaking rules after Net Points.
6. Exact Head-to-Head calculation when three or more players are tied.
7. Exact knockout crossover rules for each tournament configuration.
8. Exact seeded-player distribution algorithm.
9. Exact scoring rules for 21-point matches.
10. Exact scoring rules for 30-point matches.
11. Exact interval rules.
12. Exact Yellow Card and Red Card behavior.
13. Exact ranking point calculation.
14. Ranking point expiration rules, if any.
15. Tournament category permissions.
16. Student and staff domain authorization rules.
17. Waitlist promotion rules.
18. Match rescheduling rules.
19. Match cancellation rules.
20. Organizer override procedures.

These decisions should be documented in the appropriate files inside `/docs`.

---

# 49. Related Documentation

The following documents should provide detailed specifications for the requirements defined in this document:

- `project-vision.md`
- `user-roles.md`
- `user-flows.md`
- `tournament-rules.md`
- `draw-and-seeding.md`
- `seeding-algorithm.md`
- `match-rules.md`
- `ranking-system.md`
- `scheduling-system.md`
- `notification-system.md`
- `database-schema.md`
- `api-specification.md`
- `security-rules.md`
- `testing-requirements.md`
- `ui-design-system.md`
- `future-features.md`