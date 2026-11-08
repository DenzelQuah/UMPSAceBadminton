"use server"

import { revalidatePath } from "next/cache"

import { apiError, type ApiResponse } from "@/lib/apiResponse"
import { requireAuthenticated } from "@/lib/auth/authorization"
import type { Registration } from "@/app/(dashboard)/tournaments/types"
import { playerRegistrations } from "@/lib/supabase/schema"

function registrationFailure(error: { code?: string }): ApiResponse<never> {
  console.error("Registration operation failed", { code: error.code })

  if (error.code === "23505") {
    return apiError(
      "BAD_REQUEST",
      409,
      "You are already registered for this category."
    )
  }
  if (error.code === "P0001") {
    return apiError(
      "INVALID_STATE_TRANSITION",
      422,
      "Registration is not open for this category."
    )
  }
  if (error.code === "P0002") {
    return apiError("NOT_FOUND", 404, "The category could not be found.")
  }
  return apiError(
    "DATABASE_ERROR",
    500,
    "Your registration could not be updated. No partial changes were saved."
  )
}

export async function registerForCategory(
  categoryId: string
): Promise<ApiResponse<{ status: "CONFIRMED" | "WAITLISTED" }>> {
  const auth = await requireAuthenticated()
  if (!auth.ok) return auth.response

  const { data, error } = await auth.supabase.rpc("register_for_category", {
    category_uuid: categoryId,
  })

  if (error) return registrationFailure(error)
  revalidatePath("/dashboard")
  revalidatePath("/tournaments")
  return {
    success: true,
    data: { status: data as "CONFIRMED" | "WAITLISTED" },
    message:
      data === "WAITLISTED"
        ? "The category is full, so you were added to the waitlist."
        : "Your category registration is confirmed.",
  }
}

export async function withdrawRegistration(
  registrationId: string
): Promise<ApiResponse<{ status: "WITHDRAWN" }>> {
  const auth = await requireAuthenticated()
  if (!auth.ok) return auth.response

  const { error } = await auth.supabase.rpc("withdraw_registration", {
    registration_uuid: registrationId,
  })

  if (error) return registrationFailure(error)
  revalidatePath("/dashboard")
  return { success: true, data: { status: "WITHDRAWN" } }
}

export async function getPlayerRegistrations(): Promise<
  ApiResponse<Registration[]>
> {
  const auth = await requireAuthenticated()
  if (!auth.ok) return auth.response

  return playerRegistrations(auth.supabase, auth.userId)
}
