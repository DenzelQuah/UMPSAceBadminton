# UMPSAce Badminton

## 1. Project Overview

UMPSAce Badminton is a badminton tournament management platform
designed for Universiti Malaysia Pahang Al-Sultan Abdullah (UMPSA).

The system aims to digitize and automate the tournament management
process from player registration, tournament grouping, match scheduling,
live scoring, tournament progression, and player ranking.

The main goal is to reduce the amount of manual work required by
tournament organizers and provide players and tournament officials
with a centralized platform to manage and monitor badminton tournaments.

---

## 2. Main Vision

The system should allow an organizer to create and manage a complete
badminton tournament.

The tournament process should follow this general flow:

1. Organizer creates a tournament.
2. Players register for the tournament.
3. Organizer closes registration.
4. Organizer selects seeded players.
5. Organizer starts the automated draw.
6. The system distributes seeded players fairly across groups.
7. The system randomly distributes remaining players.
8. The system generates the group stage.
9. The system generates match schedules.
10. The system assigns umpires and linesmen.
11. Umpires record live match scores.
12. The system records match results.
13. The system calculates group standings.
14. The system determines which players qualify for the knockout stage.
15. The system generates the knockout bracket.
16. Winners automatically progress through the bracket.
17. The tournament is completed.
18. Player rankings are updated.

---

## 3. Main Users

The system supports the following users:

1. Organizer
2. Player
3. Umpire
4. Linesman

A single user account may have multiple roles.

For example, one user may simultaneously be:

- Player
- Umpire
- Linesman

The role system should therefore support multiple roles for a single user.

---

## 4. Organizer

The Organizer is responsible for managing the tournament.

The Organizer should be able to:

- Create tournaments
- Configure tournament settings
- Open player registration
- Close player registration
- View registered players
- Select seeded players
- Start the automated draw
- Preview the generated draw
- Publish the official draw
- Assign umpires
- Assign linesmen
- Monitor ongoing matches
- View tournament standings
- View match results
- Correct incorrect match results
- Manage tournament progression
- Complete the tournament

---

## 5. Player

Players should be able to:

- Login using their UMPSA account
- View available tournaments
- Join tournaments
- View tournament information
- View the tournament draw
- View their assigned group
- View upcoming matches
- View match schedules
- View tournament results
- View match history
- View player rankings
- Contact tournament organizers

---

## 6. Umpire

An Umpire is a user who is assigned to officiate matches.

The Umpire should be able to:

- View assigned matches
- View match details
- Start a match
- Record live scores
- Record game points
- Record player warnings
- Record yellow cards or interruption records
- Manage match intervals
- Record game completion
- Set the winner
- Submit the final match result

---

## 7. Linesman

A Linesman is a user who is assigned to assist with a match.

The Linesman should be able to:

- View assigned matches
- View match details
- View match time
- View court number
- Receive notifications about assigned matches

A Linesman should not be able to modify the official match score.

---

## 8. Automated Tournament Draw

The Organizer should have the ability to manually start the automated tournament draw.

The automated draw should NOT start automatically.

The Organizer should first:

1. Close player registration.
2. Confirm the registered players.
3. Select seeded players.
4. Configure the number of groups.
5. Start the automated draw.

The system should then:

1. Validate the tournament.
2. Validate the registered players.
3. Validate seeded players.
4. Distribute seeded players fairly across groups.
5. Randomly distribute the remaining players.
6. Ensure groups are balanced.
7. Ensure every player appears exactly once.
8. Generate the group stage.
9. Generate group stage matches.
10. Generate the tournament schedule.

The Organizer should be able to preview the generated draw before publishing it.

After the Organizer publishes the draw, the draw becomes the official tournament draw.

---

## 9. Seeded Player Rule

The system should distribute seeded players fairly across the groups.

The preferred rule is:

Each group should contain one seeded player when possible.

For example:

8 groups
8 seeded players

The system should distribute:

Group A → Seed 1
Group B → Seed 2
Group C → Seed 3
Group D → Seed 4
Group E → Seed 5
Group F → Seed 6
Group G → Seed 7
Group H → Seed 8

The system should avoid placing multiple seeded players in the same group
when another group does not yet contain a seeded player.

The exact seeding and distribution algorithm will be defined separately.

---

## 10. Group Standings

The system should automatically calculate player standings
after match results are recorded.

The standings should consider:

1. Match wins
2. Net points

The current intended rule is:

If two players have the same number of match wins,
the player with the higher net point should rank higher.

Net points are calculated using:

Points Scored - Points Conceded

Additional tie-breaking rules are still to be finalized.

---

## 11. Knockout Stage

After the group stage is completed, qualified players
should automatically progress to the knockout stage.

Example:

Group A winner vs Group H winner
Group B winner vs Group G winner
Group C winner vs Group F winner
Group D winner vs Group E winner

The exact knockout qualification rules will be defined
in the tournament rules documentation.

---

## 12. Player Ranking

The system should maintain player rankings based on
performance across tournaments.

The ranking system should allow players to see
their competitive standing compared with other players.

The exact ranking calculation will be defined separately.

---

## 13. Platform

The first version of UMPSAce Badminton should be a responsive
web application.

The system should work on:

- Desktop
- Tablet
- Mobile phone

The application should provide an optimized experience for:

- Organizers
- Players
- Umpires
- Linesmen

---

## 14. Future Vision

UMPSAce may eventually become a broader sports tournament
management platform.

The initial version will focus on badminton.

Future versions may support additional sports.

The first version should therefore be designed in a way
that allows future expansion without unnecessarily
complicating the initial development.