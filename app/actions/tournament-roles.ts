"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { apiError, apiSuccess, type ApiResponse } from "@/lib/apiResponse"
import { requireAuthenticated, requireCommittee } from "@/lib/auth/authorization"
import { databaseReadFailure } from "@/lib/supabase/schema"

export type AjkApplication = {
  id: string; user_id: string; tournament_id: string;
  status: "PENDING" | "APPROVED" | "REJECTED"; created_at: string;
}
export type PendingAjk = Omit<AjkApplication, "status"> & {
  full_name: string; email: string; tournament_title: string;
}

function failure(error: { code?: string }) {
  if (error.code === "P0002") return apiError("NOT_FOUND",404,"This tournament or application is no longer available.")
  if (["22023","P0001"].includes(error.code ?? "")) return apiError("INVALID_STATE_TRANSITION",409,"This application has already been reviewed, or applications for this tournament are closed. Refresh to see the latest status.")
  return databaseReadFailure(error)
}

export async function getMyAjkApplications(): Promise<ApiResponse<AjkApplication[]>> {
  const auth = await requireAuthenticated()
  if (!auth.ok) return auth.response
  const { data, error } = await auth.supabase.from("tournament_ajk_applications")
    .select("id,user_id,tournament_id,status,created_at").eq("user_id",auth.userId).order("created_at",{ ascending:false })
  return error ? failure(error) : apiSuccess(data ?? [])
}

export async function applyForTournamentAjk(tournamentId: string): Promise<ApiResponse<AjkApplication>> {
  const auth = await requireAuthenticated()
  if (!auth.ok) return auth.response
  if (!z.string().uuid().safeParse(tournamentId).success) return apiError("VALIDATION_ERROR",400,"Choose a tournament first.")
  const { data, error } = await auth.supabase.rpc("apply_for_tournament_ajk",{ tournament_uuid:tournamentId })
  if (error) return failure(error)
  revalidatePath("/dashboard")
  revalidatePath(`/tournaments/${tournamentId}`)
  revalidatePath("/mt")
  return apiSuccess(data as AjkApplication)
}

export async function getPendingAjkApplications(): Promise<ApiResponse<PendingAjk[]>> {
  const auth = await requireCommittee()
  if (!auth.ok) return auth.response
  const { data, error } = await auth.supabase.rpc("list_pending_tournament_ajk")
  return error ? failure(error) : apiSuccess((data ?? []) as PendingAjk[])
}

export async function reviewTournamentAjk(id: string, approve: boolean): Promise<ApiResponse<void>> {
  const auth = await requireCommittee()
  if (!auth.ok) return auth.response
  if (!z.object({ id:z.string().uuid(),approve:z.boolean() }).safeParse({ id,approve }).success) return apiError("VALIDATION_ERROR",400,"Choose a valid application and decision.")
  const { error } = await auth.supabase.rpc("review_tournament_ajk",{ application_uuid:id,approve })
  if (error) return failure(error)
  revalidatePath("/","layout")
  return apiSuccess(undefined)
}
