import "server-only"

import { apiError, type ApiFailure, type ApiResponse } from "@/lib/apiResponse"
import { createClient } from "@/lib/supabase/server"
import { readActorProfile } from "@/lib/auth/actor-profile"
import { canManageTournaments, canAssignMatchOfficials, type OrganizationalRole } from "@/lib/auth/organizational-roles"

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

export type AuthenticatedContext = {
  ok: true
  supabase: SupabaseServerClient
  userId: string
}

export type CommitteeContext = AuthenticatedContext & {
  profile: {
    id: string
    full_name: string
    email: string
    is_admin: boolean
    organizational_role: OrganizationalRole
  }
}

export type AuthFailure = {
  ok: false
  response: ApiFailure
}

export type AuthResult<T extends AuthenticatedContext = AuthenticatedContext> =
  | T
  | AuthFailure

export async function requireAuthenticated(): Promise<AuthResult> {
  const supabase = await createClient()
  const { data, error } = await supabase.auth.getClaims()

  if (error || !data?.claims?.sub) {
    return {
      ok: false,
      response: apiError(
        "UNAUTHORIZED",
        401,
        "Your session has expired. Sign in again to continue."
      ),
    }
  }

  return {
    ok: true,
    supabase,
    userId: data.claims.sub,
  }
}

export async function requireCommittee(): Promise<AuthResult<CommitteeContext>> {
  return requireApprovedStaff(canManageTournaments,"Tournament management requires approved MT or administrator access.")
}

export async function requireMatchOfficialManager(): Promise<AuthResult<CommitteeContext>> {
  return requireApprovedStaff(canAssignMatchOfficials,"Assigning match officials requires approved MT, EXCO or administrator access.")
}

async function requireApprovedStaff(allowed:typeof canManageTournaments,message:string): Promise<AuthResult<CommitteeContext>> {
  const auth = await requireAuthenticated()
  if (!auth.ok) return auth

  const { data: profile, error } = await readActorProfile(auth.supabase)

  if (error || !profile) {
    console.error("Committee profile lookup failed", { code: error?.code })
    return {
      ok: false,
      response: apiError(
        "DATABASE_ERROR",
        500,
        "We could not verify your committee access. Please try again."
      ),
    }
  }

  if (!allowed(profile)) {
    return {
      ok: false,
      response: apiError(
        "AUTH_FORBIDDEN",
        403,
        message
      ),
    }
  }

  return {
    ...auth,
    profile: {
      id: profile.id,
      full_name: profile.full_name,
      email: profile.email,
      is_admin: profile.is_admin,
      organizational_role: profile.organizational_role,
    },
  }
}

export function authFailureResponse<T>(auth: AuthResult): ApiResponse<T> | null {
  return auth.ok ? null : auth.response
}

export async function requirePlatformAdmin(): Promise<AuthResult<CommitteeContext>> {
  const auth = await requireCommittee()
  if (!auth.ok) return auth
  if (!auth.profile.is_admin) return { ok: false, response: apiError("AUTH_FORBIDDEN", 403, "Only a platform administrator can approve organizational access.") }
  return auth
}
