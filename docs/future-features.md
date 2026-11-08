# UMPSAce Badminton - Product Roadmap & Future Architectural Expansions

**Scope amendment, 5 November 2026:** The user explicitly authorized doubles pairing now, with partner consent and at most one main-squad player per pair. The singles-only restriction below no longer applies to that work. QR check-in, certificates, overlays and other future features remain deferred. Doubles use the existing scoring formats; automatic individual service rotation is not part of this amendment.

**Document Version:** 1.0  
**Related Documents:** `product-requirement.md`, `database-schema.md`, `api-specification.md`, `tournament-rules.md`  
**Governance Scope:** Post-MVP Roadmap & Scope Guardrails

---

## 1. Executive Summary & MVP Boundary Rule

The UMPSAce Badminton architecture is designed for long-term scalability across Universiti Malaysia Pahang Al-Sultan Abdullah (UMPSA). However, to ensure a rapid, stable deployment for upcoming campus tournaments, a strict scope boundary must be enforced.

> **THE MVP BOUNDARY RULE:**  
> All features, workflows, and database schemas detailed in this document (`docs/future-features.md`) are explicitly **OUT OF SCOPE** for the initial MVP release (Phase 1). Developers and autonomous AI coding agents **MUST NOT** attempt to implement, code, or generate UI components for these features during Phase 1. The guidelines below serve solely as architectural blueprints to ensure the MVP backend is built with sufficient decoupling and modularity to support these expansions in future development cycles.

---

## 2. Phase 2 Expansions (Near-Term Roadmap)

### 2.1 Courtside QR Code Check-In
* **Problem:** Players frequently warm up on empty courts or wait in the stands without notifying the assigned Umpire they have arrived, causing match delays.
* **Future Solution:** Organizers generate and print static physical QR codes taped to each physical umpire table (e.g., *Court 1*, *Court 2*).
* **Workflow:** When a player arrives at their assigned court, they open the UMPSAce mobile app and scan the QR code. The system executes a server action validating their geolocation/time slot and automatically updates their fixture check-in status to `PRESENT` on the Umpire tablet and Organizer Dashboard.

### 2.2 Doubles & Mixed Doubles Category Support
* **Problem:** Phase 1 focuses exclusively on Men's and Women's Singles to streamline database schemas and scoring logic.
* **Future Solution:** Expanding the registration and scoring engine to handle two-player teams.
* **Technical Requirements:**
  - **Partner Pairing Registration:** A user registers and inputs their partner's matric number. The partner receives an in-app confirmation prompt to lock the team registration.
  - **4-Player Schema Extension:** Expanding `matches` table foreign keys from `player_a_id` to support `team_a_id` linking to a relational `teams` table (`player_1_id`, `player_2_id`).
  - **Service Rotation Tracking:** Updating the Umpire Live Scoring tablet to track BWF odd/even service court rules, prompting the Umpire on which specific athlete should be serving from the right or left service court after each point increment.

### 2.3 Automated Achievement & Participation Certificates
* **Problem:** University committee members waste hours manually designing and typing student names into PDF certificates after tournaments finish.
* **Future Solution:** An automated post-tournament document generation pipeline.
* **Technical Requirements:**
  - When an Organizer clicks **Archive Tournament**, a background job (using headless Node.js PDF generation libraries like `@react-pdf/renderer` or `Puppeteer`) compiles institutional PDF certificates.
  - Generates **Certificates of Achievement** for Winners, Runner-Ups, and Semi-Finalists containing verified Net Points ($NP$) and signatures.
  - Generates **Certificates of Participation** for all competitors who completed their round-robin group fixtures without walkovers.
  - PDFs are uploaded to Supabase Storage and linked directly on student profile dashboards for easy download and campus merit point submissions.

---

## 3. Phase 3 Expansions (Long-Term Vision)

### 3.1 Live Broadcast & OBS Spectator Overlays
* **Vision:** Professionalizing campus tournament finals by broadcasting matches live on YouTube, Facebook, and gymnasium LED displays.
* **Technical Requirements:**
  - A specialized, read-only Next.js route: `/broadcast/court/[matchId]`.
  - Renders a borderless, high-contrast, transparent-background scoreboard display optimized for chroma-keying in OBS Studio or VMix.
  - Subscribes directly to `court-live-[matchId]` WebSocket channels to render instantaneous point animations, server shuttlecock indicators, and lower-third player name graphics without UI clutter or navigation bars.

### 3.2 Multi-Sport Extensibility (The Racket Sports Engine)
* **Vision:** Expanding UMPSAce from a badminton-specific tool into the official campus-wide tournament platform for all racket sports (Table Tennis, Squash, Tennis, and Padel).
* **Technical Requirements:**
  - The underlying **Constraint Satisfaction Problem (CSP) Scheduling Engine**, **Fisher-Yates Snake-Seeding Algorithm**, and **BWF Round-Robin Standings Math** are mathematically agnostic to the sport being played.
  - By abstracting scoring rules into configuration schemas (e.g., changing 21-point rally scoring to 11-point Table Tennis scoring or traditional Tennis set scoring), the platform can host inter-faculty tournaments across multiple sports facilities simultaneously.

---

## 4. Architectural Readiness Guidelines (For MVP Developers & AI Agents)

To ensure the MVP codebase can cleanly absorb these future features without requiring database migrations or total rewrites, developers must enforce the following decoupling principles during Phase 1 implementation:

1. **Keep Scoring Formats as ENUMs:** Never hardcode integer checks like `if (score === 21)` directly in UI components. Always evaluate win conditions against the category's `scoring_format` ENUM configuration (`STANDARD_21`, `SINGLE_30`), allowing easy injection of future formats like `DOUBLES_21` or `TABLE_TENNIS_11`.
2. **Abstract Player References in UI Cards:** When rendering match fixtures, wrap competitor details in a reusable `<CompetitorDisplay />` component rather than inline string rendering. This ensures that when Phase 2 introduces Doubles teams, you only need to update one component to render two names instead of refactoring every schedule card in the application.
3. **Preserve Audit Trail Extensibility:** The `audit_logs` table JSONB payloads (`old_payload`, `new_payload`) must remain schema-less. This guarantees that future destructive actions—such as manually overriding doubles service rotations or revoking issued certificates—can be logged instantly without altering PostgreSQL column definitions.
