"use server"

import { z } from "zod"
import { revalidatePath } from "next/cache"

import { apiError, type ApiResponse } from "@/lib/apiResponse"
import { requireCommittee, requireMatchOfficialManager } from "@/lib/auth/authorization"

export type MatchOfficialAssignment = {
  match: {
    id: string; tournament_id: string; tournament_title: string; category_name: string
    status: string; scheduled_time: string | null; court_number: number | null
    umpire_id: string | null; linesman_id: string | null; umpire_name: string | null; linesman_name: string | null
    player_a_name: string; player_b_name: string; locked: boolean
  }
  officials: {
    id: string; full_name: string; organizational_role: string; organizational_role_detail: string
    available: boolean; unavailable_reason: string | null
  }[]
}

export interface ProfileBrief {
  id: string
  full_name: string
  email: string
  organizational_role?: string
  organizational_role_detail?: string
}

export interface ManagedUser extends ProfileBrief {
  matric_number: string | null
  is_admin: boolean
  is_community_member: boolean
}

const assignmentSchema = z.object({
  matchId: z.string().uuid(),
  umpireId: z.string().uuid().nullable(),
  linesmanId: z.string().uuid().nullable(),
})

function assignmentFailure(error: { code?: string }): ApiResponse<never> {
  console.error("Official assignment failed", { code: error.code })
  if (error.code === "42501") return apiError("AUTH_FORBIDDEN",403,"Approved MT, EXCO or administrator access is required to assign officials.")
  if (error.code === "PGRST202") return apiError("DATABASE_SETUP_REQUIRED",503,"Match official availability needs a database update. Ask a System Admin to apply the latest migrations.")
  if (error.code === "P0001") {
    return apiError(
      "SCHEDULE_CONFLICT",
      409,
      "The match is locked or an official is no longer available. Refresh availability and try again."
    )
  }
  if (["22023", "23514"].includes(error.code ?? "")) {
    return apiError(
      "VALIDATION_ERROR",
      422,
      "Choose eligible officials who are not playing in this match."
    )
  }
  if (error.code === "P0002") {
    return apiError("NOT_FOUND", 404, "The selected match was not found.")
  }
  return apiError(
    "DATABASE_ERROR",
    500,
    "The official assignment could not be saved."
  )
}

export async function assignOfficial(payload: {
  matchId: string
  umpireId: string | null
  linesmanId: string | null
}): Promise<ApiResponse<void>> {
  const auth = await requireMatchOfficialManager()
  if (!auth.ok) return auth.response

  const parsed = assignmentSchema.safeParse(payload)
  if (!parsed.success) {
    return apiError("VALIDATION_ERROR", 400, "Select valid match officials.")
  }

  const { data,error } = await auth.supabase.rpc("assign_match_officials", {
    match_uuid: parsed.data.matchId,
    umpire_uuid: parsed.data.umpireId,
    linesman_uuid: parsed.data.linesmanId,
  })

  if (error) return assignmentFailure(error)
  if(!Array.isArray(data) || data[0]?.id!==parsed.data.matchId || data[0]?.umpire_id!==parsed.data.umpireId || data[0]?.linesman_id!==parsed.data.linesmanId){
    return apiError("DATABASE_ERROR",500,"The saved assignment could not be confirmed. Refresh availability before retrying.")
  }
  revalidatePath(`/matches/${parsed.data.matchId}/officials`)
  revalidatePath("/admin/tournaments/[tournamentId]","page")
  revalidatePath("/tournaments/[tournamentId]","page")
  revalidatePath("/umpire")
  return { success: true, data: undefined }
}

export async function getMatchOfficialAvailability(matchId:string):Promise<ApiResponse<MatchOfficialAssignment>> {
  const auth=await requireMatchOfficialManager()
  if(!auth.ok)return auth.response
  if(!z.string().uuid().safeParse(matchId).success)return apiError("VALIDATION_ERROR",400,"Choose a valid match.")
  const {data,error}=await auth.supabase.rpc("get_match_official_availability",{match_uuid:matchId})
  if(error)return assignmentFailure(error)
  if(!data)return apiError("NOT_FOUND",404,"The selected match was not found.")
  return {success:true,data:data as MatchOfficialAssignment}
}

export async function getAllProfiles(tournamentId?: string): Promise<ApiResponse<ProfileBrief[]>> {
  const auth = await requireCommittee()
  if (!auth.ok) return auth.response

  if (tournamentId && !z.string().uuid().safeParse(tournamentId).success) return apiError("VALIDATION_ERROR",400,"Choose a valid tournament.")
  let { data, error } = tournamentId
    ? await auth.supabase.rpc("tournament_officials", { tournament_uuid: tournamentId })
    : await auth.supabase.rpc("approved_organization_officials")
  if (tournamentId && error?.code === "PGRST202") {
    const previous = await auth.supabase.rpc("approved_organization_officials")
    data = previous.data; error = previous.error
  }
  if (error?.code === "PGRST202") {
    const legacy = await auth.supabase.rpc("available_officials")
    data = legacy.data
    error = legacy.error
  }
  if (error) {
    console.error("Officials lookup failed", { code: error.code })
    return apiError(
      "DATABASE_ERROR",
      500,
      "The officials roster could not be loaded."
    )
  }
  return { success: true, data: (data ?? []) as ProfileBrief[] }
}

export async function getManagedUsers(): Promise<ApiResponse<ManagedUser[]>> {
  const auth = await requireCommittee()
  if (!auth.ok) return auth.response

  const { data, error } = await auth.supabase.rpc("admin_list_profiles")
  if (error) {
    console.error("Managed user lookup failed", { code: error.code })
    return apiError(
      "DATABASE_ERROR",
      500,
      "Platform users could not be loaded."
    )
  }

  return { success: true, data: (data ?? []) as ManagedUser[] }
}

export async function setCommunityMembership(
  userId: string,
  enabled: boolean
): Promise<ApiResponse<{ enabled: boolean }>> {
  const auth = await requireCommittee()
  if (!auth.ok) return auth.response

  const { error } = await auth.supabase.rpc("set_community_membership", {
    target_profile_id: userId,
    enabled,
  })

  if (error) {
    if (error.code === "42501") {
      return apiError(
        "AUTH_FORBIDDEN",
        403,
        error.message.includes("own membership")
          ? "You cannot change your own membership status."
          : "Administrator access is required."
      )
    }
    return apiError(
      "DATABASE_ERROR",
      500,
      "The user's club membership could not be updated."
    )
  }

  return { success: true, data: { enabled } }
}
