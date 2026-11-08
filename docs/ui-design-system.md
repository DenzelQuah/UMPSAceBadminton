# UMPSA Tournament UI/UX Design System Specification

## Immersive Home access cards — 9 November 2026

The signed-in Home dashboard (`/dashboard`) places MT tournament operations first: event creation and management, followed by an ordered flow from setup, registration and committee preparation, seeds and draw, courts and officials, live scoring, through results and completion. Compact shortcuts open MT approvals, match scoring/duties and published standings. System Admin organization appointments follow these operational controls.

Join the community and Organizer access are secondary access points at the bottom of Home, after the operational controls and applicable approval forms. Emerald/court and navy/bracket gradients sit behind inline decorative vector artwork and translucent glass content panels. Gold Join Now opens tournaments. The outlined Access Dashboard action opens `/mt` for approved MT/Admin users; approved committee members instead see View Committee Duties, while players can navigate to the existing organizer approval request section.

The layout stacks on narrow screens and uses two columns when the dashboard content container reaches 48rem, accounting for the global sidebar. Buttons have generous touch targets, keyboard focus rings and reduced-motion-aware hover effects. Server-rendered cards and decorative vectors require no image downloads, video or new rendering dependency. The sign-in page retains its directly visible login/register form. Existing approved-role checks and application visibility rules remain in force.

**Document Version:** 1.0  
**Related Documents:** `product-requirement.md`, `user-roles.md`, `user-flows.md`, `match-rules.md`  
**Governance Standard:** WCAG 2.1 AA Accessibility Standards + UMPSA Institutional Identity Guidelines

---

## 1. Executive Summary

This document specifies the authoritative user interface (UI) and user experience (UX) design system for **UMPSAce Badminton**. It outlines styling tokens, component guidelines, and device ergonomics optimized for the platform's multi-role ecosystem. This ensures that student competitors, tournament organizers, and courtside officials receive high-contrast, responsive, and tactile interfaces tailored to their environments.

---

## 2. Design Stack & Library Fundamentals

To guarantee rapid development, semantic accessibility, and a unified design vocabulary, the platform standardizes on the following technologies:

* **Styling Engine:** **Tailwind CSS** (for utility-first, declarative responsive design).
* **Component Primitives:** **Shadcn UI** built on **Radix UI** primitives (providing accessible, screen-reader friendly, keyboard-navigable components such as Modals, Dropdowns, and Dialogs).
* **Iconography:** **Lucide Icons** (a crisp, consistent line-art library styled dynamically via Tailwind class utility colors).

---

## 3. Institutional Color Palette & Branding Tokens

The color architecture directly incorporates the official color guidelines of Universiti Malaysia Pahang Al-Sultan Abdullah (UMPSA), accented by standard semantic status rules.

```
 [ UMPSA Color Palette Tokens ]
  ├── Primary: Deep Royal Blue (Primary Branding, Core Actions)
  ├── Accent: Gold / Amber (Winner Highlights, Active Courts)
  └── Semantic Statuses:
       ├── Emerald (Success, Live Court States)
       ├── Yellow (#EAB308 - Yellow Card Warnings)
       └── Crimson (#EF4444 - Red Card Faults, Deletions)
```

### 3.1 Core Brand Colors
* **Primary (UMPSA Deep Royal Blue):** Used for main global navigation, dashboard headers, primary buttons, and main brand actions.
  * *Tailwind Config Token:* `theme.extend.colors.primary` $\rightarrow$ `bg-[#0B3C5D]` / `text-[#0B3C5D]`
* **Accent / Secondary (UMPSA Gold / Amber):** Used for tournament podium highlights, winner badges, active court banners, and special indicator points.
  * *Tailwind Config Token:* `theme.extend.colors.accent` $\rightarrow$ `bg-[#D9B310]` / `text-[#D9B310]`

### 3.2 Semantic Status Colors
* **Success / Live Active:** Emerald green, signifying live scoreboards, completed matches, and active courts.
  * *Hex Value:* `#10B981` (Tailwind `emerald-500`)
* **Disciplinary Warning:** BWF-standard Yellow Card warnings.
  * *Hex Value:* `#EAB308` (Tailwind `yellow-500`)
* **Disciplinary Fault / Destructive Actions:** BWF-standard Red Card faults and administrative deletions.
  * *Hex Value:* `#EF4444` (Tailwind `red-500`)

---

## 4. Role-Specific Viewport Ergonomics

UMPSAce serves three distinct users across three radically different physical and lighting environments. The layout engine enforces targeted responsive behaviors for each viewport category.

### 4.1 Umpire Courtside Tablet (Landscape-First Viewport)
Umpires operate in highly lit gymnasium environments. The UI must optimize for speed, physical stability, and sweat-resistant touch interactions.

```
+-----------------------------------------------------------------------+
|  Match #14 | Court 3 | STANDARD_3x21                  [ CALL REF ]    |
+---------------------------------------------------+-------------------+
|                                                   |                   |
|                   PLAYER A                        |     PLAYER B      |
|                                                   |                   |
|                     14                            |       11          |
|                                                   |                   |
|                   [ +1 ]                          |     [ +1 ]        |
|                                                   |                   |
+---------------------------------------------------+-------------------+
|  [UNDO]  |  [Y-CARD]  |  [R-CARD]                 | [ SUBMIT MATCH ]  |
+---------------------------------------------------+-------------------+
```

* **Device Target:** 10-inch Tablet in Landscape orientation.
* **Ergonomic Standards:**
  * **Gymnasium Contrast:** Full dark-mode UI with bright neon scores to prevent light glare from overhead court lamps.
  * **Massive Touch Targets:** Score increment touch regions (`+1` buttons) must satisfy a **minimum size of 64x64px** (ideally split-screen half-tap areas where tapping anywhere on the left half of the tablet increments Player A's score, and the right half increments Player B's score).
  * **Interference Shield:** Point decrement (Undo) and Card buttons must be separated from score targets by a minimum 32px safe-zone to avoid accidental triggering during intensive play.

### 4.2 Player Competitor Dashboard (Portrait-First Viewport)
Designed for student-athletes walking around the venue or checking fixtures from their dormitories.

* **Device Target:** Mobile Phones in Portrait orientation.
* **Ergonomic Standards:**
  * **Scannable Schedules:** Upcoming fixtures are rendered as card interfaces showing: opponent name, court assignment, and estimated start times.
  * **Dynamic Toasts:** When the scheduling engine recovery routine pulls a player's match forward, a high-priority push alert card slides down from the viewport top with a vibration pulse.
  * **Live-Table Density:** Group standings tables are optimized for vertical screens, collapsing to show *Matches Won/Lost ($W/L$)* and *Net Points ($NP$)* as core metrics, with tertiary scores expandable on tap.

### 4.3 Organizer Admin Portal (Wide-Screen Desktop Viewport)
Organizers coordinate the overall tournament flow. They require high-density data visualizations to monitor the venue status.

* **Device Target:** Desktop Monitors (1920x1080 minimum resolution).
* **Ergonomic Standards:**
  * **Multi-Court Grid Monitoring:** Renders a responsive dashboard grid displaying active live scores for all physical courts (e.g., Courts 1 through 6) side-by-side.
  * **Dense Standings Tables:** Rich administrative tables displaying complete round-robin metrics ($Pld, W, L, PW, PL, NP, Pts$) with drag-and-drop match rescheduling features.
  * **Knockout Trees:** Horizontal scrolling SVG bracket trees that automatically render qualified players progressing through Quarterfinals, Semifinals, and Finals.

---

## 5. Component Accessibility & Touch Interaction Standards

To ensure software accessibility and responsive tactile behaviors, all frontend components must implement the following controls:

### 5.1 Color Contrast & Sizing Compliance
* **WCAG 2.1 AA Compliance:** All text and button interactions must maintain a color contrast ratio of at least **4.5:1** against the background.
* **Typography Hierarchy:** Uses fluid, highly-legible system sans-serif fonts (`Inter`, `system-ui`) with standard type scales to ensure clear reading from a distance (especially courtside).

### 5.2 Tactile & Visual Feedback Standards
Every score adjustment must trigger immediate multi-sensory feedback on the Umpire's tablet:
1. **Haptic Pulse:** Standard score increments trigger a brief, crisp 10ms hardware vibration pulse (via Web Vibe API).
2. **Visual Flash:** The score number container flashes briefly (using a fast Tailwind animate-scale-up-fade effect) to visually confirm the database record committed successfully.

### 5.3 Destructive Action Sign-Off Modals
To prevent premature match finalization or accidental data deletions:
* **The Match Sign-Off Modal:** Submitting the final score locks the match permanently. The submit button must trigger an explicit confirmation modal displaying:
  * *"Umpire Verification: Verify Player A wins 21-14, 21-11. Once submitted, this score is locked and cannot be edited by the Umpire."*
* **Verification Match Lock:** The Umpire must tap a confirmation switch (or slide-to-confirm gesture) to commit, avoiding accidental double-taps on the touchscreen.
