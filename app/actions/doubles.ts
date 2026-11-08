"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { apiError, apiSuccess, type ApiResponse } from "@/lib/apiResponse"
import { requireAuthenticated, requireCommittee } from "@/lib/auth/authorization"
import { categoryEntries } from "@/lib/tournament/entries"
import { databaseReadFailure, isMissingFunction } from "@/lib/supabase/schema"
import type { Registration } from "@/app/(dashboard)/tournaments/types"

export type Invitation = { id: string; inviter_id: string; partner_id: string; inviter_name: string; partner_name: string; status: string }
export type PairState = { userId: string; invitations: Invitation[]; registration: Registration | null; displayName: string | null }
export type SquadPlayer = { id: string; full_name: string; email: string; isMainSquad: boolean }

function failure(error: { code?: string; message?: string }): ApiResponse<never> {
  if (isMissingFunction(error) || ["42P01", "42703"].includes(error.code ?? "")) return databaseReadFailure(error)
  const messages: Record<string, string> = {
    "42501": "You do not have permission to perform this action.",
    "23505": "One of these players already has a registration or pending invitation in this category.",
    "23503": "The selected player or tournament no longer exists.",
    "22023": "The pair is ineligible. Two main-squad players cannot partner; choose another registered account.",
    P0001: "This step is no longer available. Registration or the squad roster is locked.",
    P0002: "The requested tournament or category could not be found.",
  }
  return apiError(error.code === "42501" ? "AUTH_FORBIDDEN" : "VALIDATION_ERROR", error.code === "42501" ? 403 : 422,
    messages[error.code ?? ""] ?? "The pairing operation could not be completed. Please try again.")
}

export async function getPairState(categoryId: string): Promise<ApiResponse<PairState>> {
  const auth = await requireAuthenticated()
  if (!auth.ok) return auth.response
  if (!z.string().uuid().safeParse(categoryId).success) return apiError("BAD_REQUEST", 400, "Choose a valid category.")
  const [invites, registrations] = await Promise.all([
    auth.supabase.rpc("get_my_doubles_invitations", { category_uuid: categoryId }),
    auth.supabase.rpc("get_my_registrations"),
  ])
  if (invites.error || registrations.error) return failure(invites.error ?? registrations.error ?? {})
  const registration = ((registrations.data ?? []) as Registration[]).find((r) => r.category_id === categoryId && r.status !== "WITHDRAWN") ?? null
  const entries = await categoryEntries(auth.supabase, [categoryId])
  if (!entries.success) return entries
  return apiSuccess({ userId: auth.userId, invitations: invites.data ?? [], registration,
    displayName: entries.data.find((entry) => entry.representative_id === registration?.player_id)?.display_name ?? null })
}

export async function inviteDoublesPartner(categoryId: string, partnerEmail: string): Promise<ApiResponse<void>> {
  const auth = await requireAuthenticated()
  if (!auth.ok) return auth.response
  const input = z.object({ categoryId: z.string().uuid(), partnerEmail: z.string().trim().email().max(255) }).safeParse({ categoryId, partnerEmail })
  if (!input.success) return apiError("VALIDATION_ERROR", 400, "Enter your partner's institutional email.")
  const { error } = await auth.supabase.rpc("invite_doubles_partner", { category_uuid: input.data.categoryId, partner_email: input.data.partnerEmail })
  if (error) return failure(error)
  revalidatePath("/tournaments", "layout")
  return apiSuccess(undefined)
}

export async function respondDoublesInvitation(invitationId: string, response: "ACCEPT" | "DECLINE" | "CANCEL"): Promise<ApiResponse<{ status: string }>> {
  const auth = await requireAuthenticated()
  if (!auth.ok) return auth.response
  const input = z.object({ invitationId: z.string().uuid(), response: z.enum(["ACCEPT", "DECLINE", "CANCEL"]) }).safeParse({ invitationId, response })
  if (!input.success) return apiError("BAD_REQUEST", 400, "Choose a valid invitation response.")
  const { data, error } = await auth.supabase.rpc("respond_doubles_invitation", { invitation_uuid: input.data.invitationId, response: input.data.response })
  if (error) return failure(error)
  revalidatePath("/tournaments", "layout")
  revalidatePath("/admin", "layout")
  return apiSuccess({ status: String(data) })
}

export async function getTournamentSquad(tournamentId: string): Promise<ApiResponse<SquadPlayer[]>> {
  const auth = await requireCommittee()
  if (!auth.ok) return auth.response
  if (!z.string().uuid().safeParse(tournamentId).success) return apiError("BAD_REQUEST", 400, "Choose a valid tournament.")
  const [users, members] = await Promise.all([
    auth.supabase.rpc("admin_list_profiles"),
    auth.supabase.from("tournament_squad_members").select("profile_id").eq("tournament_id", tournamentId),
  ])
  if (users.error || members.error) return failure(users.error ?? members.error ?? {})
  const squad = new Set((members.data ?? []).map((member) => member.profile_id))
  return apiSuccess((users.data ?? []).map((profile: { id: string; full_name: string; email: string }) => ({ ...profile, isMainSquad: squad.has(profile.id) })))
}

export async function setTournamentSquadMember(tournamentId: string, profileId: string, enabled: boolean): Promise<ApiResponse<void>> {
  const auth = await requireCommittee()
  if (!auth.ok) return auth.response
  const input = z.object({ tournamentId: z.string().uuid(), profileId: z.string().uuid(), enabled: z.boolean() }).safeParse({ tournamentId, profileId, enabled })
  if (!input.success) return apiError("BAD_REQUEST", 400, "Choose a valid squad member.")
  const { error } = await auth.supabase.rpc("set_tournament_squad_member", { tournament_uuid: tournamentId, profile_uuid: profileId, enabled })
  if (error) return failure(error)
  revalidatePath("/admin", "layout")
  return apiSuccess(undefined)
}
