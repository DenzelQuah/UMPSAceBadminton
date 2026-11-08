# UMPSA Tournament Security Rules & Architecture Specification

**Document Version:** 1.0  
**Related Documents:** `product-requirement.md`, `user-roles.md`, `database-schema.md`, `api-specification.md`  
**Governance Standard:** OWASP Top 10 Web Security Standards + Supabase RLS Guidelines

---

## 1. Executive Summary

This document defines the authoritative security architecture for **UMPSAce Badminton**. The system enforces a **Zero-Trust Backend Security Model** which guarantees that client-side UI restrictions are backed by strict server-side validation. This is achieved via Next.js Middleware route guards, institutional email domain validation rules, server-side authorization wrappers for Server Actions, and database Row-Level Security (RLS) policies.

---

## 2. Institutional Domain Enforcement

To restrict platform registration and login exclusively to authorized members of the Universiti Malaysia Pahang Al-Sultan Abdullah (UMPSA) community, the system enforces strict institutional email domain filters on all auth routes.

### 2.1 Domain Regex Constraints
Every registration and login request is validated against the following explicit regular expressions:

* **Student Account Domain:** Matches student matric identities.
  * *Regex:* `^[a-zA-Z0-9._%+-]+@adab\.umpsa\.edu\.my$`
* **Staff & Admin Account Domain:** Matches official employee identities.
  * *Regex:* `^[a-zA-Z0-9._%+-]+@umpsa\.edu\.my$`

### 2.2 Domain Parsing & Rejection Protocol
* **Rejection of Consumer Domains:** The authentication controller explicitly rejects all consumer domains, including but not limited to:
  * `gmail.com`, `yahoo.com`, `hotmail.com`, `outlook.com`, `icloud.com`, `mail.ru`
* **Server-Side Enforcement Guard:** Domain validation must be executed within the secure database constraint (`check_umpsa_email` on `profiles.email`) and re-verified on the server in the `loginWithDomain()` and registration endpoints. It is never trusted based on client-side state alone.
* **Authentication Security Action:** Any request violating this filter returns an immediate `403 Forbidden` response and terminates the token exchange.

---

## 3. Next.js Middleware Route Guards

To protect routes from unauthorized traversal, the Next.js `middleware.ts` file intercepts incoming requests and validates the user's active session and platform permissions before rendering pages.

```
 [ Incoming Request ]
          │
          ▼
  [ Check Session ] ──(No Session)──► [ Redirect /login ]
          │
     (Has Session)
          ▼
   [ Match Route ]
          │
          ├──► /dashboard/*  ──► [ Allow access ]
          │
          ├──► /admin/*      ──► [ Is is_admin == TRUE? ] ──(No)─► [ Redirect /dashboard + Toast ]
          │                                               └──(Yes)► [ Allow access ]
          │
          └──► /umpire/court/[matchId] ──► [ Is umpire_id == user_id OR is_admin == TRUE? ]
                                                     ├──(No)─► [ Redirect /dashboard + Toast ]
                                                     └──(Yes)► [ Allow access ]
```

### 3.1 `/dashboard/*` Guard
* **Rule:** Requires an active, authenticated Supabase session.
* **Violation Action:** If unauthenticated, redirects the request to `/login`, preserving the originally requested URL in the `redirect_to` query parameter.

### 3.2 `/admin/*` Guard
* **Rule:** Restricted strictly to user profiles where `is_admin = TRUE` in the database (whitelisted accounts).
* **Violation Action:** Redirects the user to `/dashboard` with an active URL parameter containing a security violation payload, prompting a red error toast: *"Unauthorized Access: Administrator privileges required."*

### 3.3 `/umpire/court/[matchId]` Guard
* **Rule:** Restricted to users where `auth.uid() = matches.umpire_id` OR `is_admin = TRUE` for that specific match fixture.
* **Behavior:** The middleware intercepts the route, parses the `matchId` UUID, queries the match metadata directly from Supabase, and performs authorization checks.
* **Violation Action:** Redirects unauthorized users back to `/dashboard` with an error toast.

---

## 4. Server Action Authorization Wrappers

Next.js Server Actions are public HTTP POST endpoints vulnerable to API spoofing if not explicitly guarded. To prevent client-side parameter manipulation, all actions in `app/actions/` must be wrapped in a secure context verifying the actor's session and permissions.

### 4.1 Technical Pattern Implementation
Every mutation-based Server Action must execute the following structured verification sequence before mutating database records:

```typescript
// app/actions/wrapper.ts
import { createClient } from '@/utils/supabase/server';

export async function verifyUserAuthorized(requiredRole: 'PLAYER' | 'UMPIRE' | 'ADMIN', targetMatchId?: string) {
  const supabase = createClient();
  
  // 1. Authenticate Session
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    throw new Error('UNAUTHORIZED_SESSION');
  }

  // 2. Fetch User Profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single();

  if (!profile) {
    throw new Error('PROFILE_NOT_FOUND');
  }

  // 3. Admin Override bypass
  if (profile.is_admin) {
    return { user, profile, role: 'ADMIN' };
  }

  // 4. Role-Specific Enforcement
  if (requiredRole === 'ADMIN' && !profile.is_admin) {
    throw new Error('ADMIN_PRIVILEGES_REQUIRED');
  }

  if (requiredRole === 'UMPIRE' && targetMatchId) {
    const { data: match } = await supabase
      .from('matches')
      .select('umpire_id, status')
      .eq('id', targetMatchId)
      .single();

    if (!match || match.umpire_id !== user.id) {
      throw new Error('NOT_THE_ASSIGNED_UMPIRE');
    }
    
    if (match.status !== 'IN_PROGRESS') {
      throw new Error('MATCH_NOT_IN_PROGRESS');
    }
  }

  return { user, profile, role: requiredRole };
}
```

This authorization check is injected at the entry point of every Server Action to enforce security independently of frontend components.

---

## 5. Destructive Action Audit Trail Enforcement

To maintain operational integrity, resolve player disputes, and ensure administrative accountability, any destructive or manually overriding administrative action must write an immutable log entry into the `audit_logs` table.

### 5.1 Actions Requiring Audit Log Generation
The following actions cannot be executed silently and mandate a structured audit entry:
1. **Referee Score Overrides:** Manually overriding game points on completed or locked matches.
2. **Forced Match Closures:** Forcing a match status to `WALKOVER` or `RETIRED` outside standard umpire flows.
3. **Manual Player Disqualification:** Overriding registration or match statuses to ban or disqualify a player.
4. **Tournament Deletion/Reset:** Purging registration registers, brackets, or match history.

### 5.2 Audit Payload Constraints
Every audit entry must record the following immutable attributes:
* **Operator Mapping (`operator_id`):** The validated UUID of the logged-in administrator executing the override.
* **Target Mapping (`target_table` & `target_id`):** The exact table and primary key UUID being mutated.
* **Immutable Snapshots (`original_data` & `new_data`):** The full row values before and after mutation stored as JSONB payloads to ensure perfect rolling recovery and inspection.
* **Mandatory Text Justification (`reason`):** The API wrapper rejects any mutation where the `reason` string is empty or contains less than 10 characters, ensuring admins cannot skip inputting reasoning.
