"use server"

import type { User } from "@supabase/supabase-js"

import { apiError, type ApiResponse } from "@/lib/apiResponse"
import {
  canAuthenticateEmail,
  institutionalDomainsAllowed,
  normalizeEmail,
} from "@/lib/auth/validation"
import { createClient } from "@/lib/supabase/server"
import type { TestPersona } from "@/lib/test-personas"
import { ORGANIZATIONAL_ROLES, type OrganizationalRole } from "@/lib/auth/organizational-roles"

export type AuthResultData = {
  user: User | null
  requiresEmailConfirmation?: boolean
}

export async function loginWithDomain(payload: {
  email: string
  password?: string
  provider: "email" | "google"
}): Promise<ApiResponse<AuthResultData>> {
  const email = normalizeEmail(payload.email)

  if (!canAuthenticateEmail(email)) {
    return apiError(
      "AUTH_FORBIDDEN",
      403,
      "Use your approved UMPSA institutional email address."
    )
  }

  if (!payload.password || payload.password.length < 6) {
    return apiError(
      "VALIDATION_ERROR",
      400,
      "Enter your password to continue."
    )
  }

  if (payload.provider === "google") {
    return apiError(
      "BAD_REQUEST",
      400,
      "Google sign-in is not available yet. Use your institutional email and password."
    )
  }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password: payload.password,
  })

  if (error || !data.user) {
    return apiError(
      "AUTH_ERROR",
      400,
      "The email or password is incorrect."
    )
  }

  return { success: true, data: { user: data.user } }
}

export async function loginWithTestPersona(payload: {
  persona?: TestPersona
}): Promise<ApiResponse<AuthResultData>> {
  const testAuthEnabled =
    process.env.NODE_ENV !== "production" && process.env.TEST_AUTH_MODE === "true"

  if (!testAuthEnabled) {
    return apiError("NOT_FOUND", 404, "Test personas are not enabled.")
  }

  const persona = payload.persona
  if (
    !persona ||
    ![
      "player-01",
      "player-02",
      "player-03",
      "player-04",
      "umpire",
      "linesman",
      "mt",
      "exco",
      "ajk",
      "admin",
    ].includes(persona)
  ) {
    return apiError("BAD_REQUEST", 400, "Choose a valid test persona.")
  }

  const envPrefixByPersona: Record<TestPersona, string> = {
    "player-01": "PLAYER01",
    "player-02": "PLAYER02",
    "player-03": "PLAYER03",
    "player-04": "PLAYER04",
    umpire: "UMPIRE",
    linesman: "LINESMAN",
    mt: "MT",
    exco: "EXCO",
    ajk: "AJK",
    admin: "ADMIN",
  }
  const envPrefix = envPrefixByPersona[persona]
  const legacyPrefix = persona === "mt" ? "UMPIRE" : persona === "exco" ? "LINESMAN" : envPrefix
  const email = process.env[`TEST_${envPrefix}_EMAIL`] ?? process.env[`TEST_${legacyPrefix}_EMAIL`]
  const password = process.env[`TEST_${envPrefix}_PASSWORD`] ?? process.env[`TEST_${legacyPrefix}_PASSWORD`]

  if (!email || !password) {
    return apiError(
      "DATABASE_ERROR",
      503,
      "This test persona is not configured. Add its server-only environment variables."
    )
  }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })

  if (error || !data.user) {
    return apiError(
      "AUTH_ERROR",
      400,
      "The test persona could not be signed in. Check its test account configuration."
    )
  }

  if (persona === "admin") {
    const { data: profileData, error: profileError } = await supabase.rpc("current_user_profile")
    const profile = Array.isArray(profileData) ? profileData[0] : profileData
    if (profileError || !profile) {
      await supabase.auth.signOut({ scope: "local" })
      return apiError("DATABASE_ERROR", 503, "The Administrator test account's access could not be verified. Try again after checking its profile.")
    }
    if (profile.is_admin !== true) {
      await supabase.auth.signOut({ scope: "local" })
      return apiError("AUTH_FORBIDDEN", 403, "The Administrator test account has not been activated as an administrator in Supabase. Ask the project owner to activate it, then sign in again.")
    }
  }

  return { success: true, data: { user: data.user } }
}

export async function signOutUser(): Promise<ApiResponse<void>> {
  const supabase = await createClient()
  const { error } = await supabase.auth.signOut()

  if (error) {
    return apiError(
      "DATABASE_ERROR",
      500,
      "We could not sign you out. Please try again."
    )
  }

  return { success: true, data: undefined }
}

export async function registerWithDomain(payload: {
  email: string
  password?: string
  fullName: string
  matricNumber?: string
  requestedRole?: OrganizationalRole
  roleDetail?: string
}): Promise<ApiResponse<AuthResultData>> {
  const email = normalizeEmail(payload.email)
  const fullName = payload.fullName.trim()
  const requestedRole = payload.requestedRole ?? "PLAYER"
  const roleDetail = payload.roleDetail?.trim() ?? ""
  if (!ORGANIZATIONAL_ROLES.includes(requestedRole) || (requestedRole !== "PLAYER" && (roleDetail.length < 2 || roleDetail.length > 100))) {
    return apiError("VALIDATION_ERROR", 400, "Select a valid role and position or team for your approval request.")
  }

  if (!canAuthenticateEmail(email)) {
    return apiError(
      "AUTH_FORBIDDEN",
      403,
      institutionalDomainsAllowed()
        ? "Use a valid email address."
        : "Use your approved UMPSA institutional email address."
    )
  }
  if (!payload.password || payload.password.length < 6) {
    return apiError(
      "VALIDATION_ERROR",
      400,
      "Password must be at least 6 characters."
    )
  }
  if (fullName.length < 2 || fullName.length > 255) {
    return apiError(
      "VALIDATION_ERROR",
      400,
      "Enter your full name as shown on your institutional record."
    )
  }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.signUp({
    email,
    password: payload.password,
    options: {
      data: {
        full_name: fullName,
        matric_number: payload.matricNumber?.trim() || null,
        requested_organizational_role: requestedRole,
        requested_role_detail: requestedRole === "PLAYER" ? "" : roleDetail,
      },
    },
  })

  if (error || !data.user) {
    return apiError(
      "AUTH_ERROR",
      400,
      "The account could not be created. Check your details and try again."
    )
  }

  return {
    success: true,
    data: {
      user: data.user,
      requiresEmailConfirmation: !data.session,
    },
  }
}
