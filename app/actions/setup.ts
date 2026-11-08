"use server"

import { apiSuccess, type ApiResponse } from "@/lib/apiResponse"
import { requireCommittee } from "@/lib/auth/authorization"
import { databaseReadFailure, isMissingFunction } from "@/lib/supabase/schema"

export type FeatureAvailability = { knockout: boolean; doubles: boolean; league: boolean; organization: boolean; tournamentRoles: boolean; dynamicDraws: boolean; liveScores:boolean }
export async function getTournamentFeatureStatus(): Promise<ApiResponse<FeatureAvailability>> {
  const auth = await requireCommittee()
  if (!auth.ok) return auth.response
  const [entries, league, knockoutMatches, knockoutPreviews, organization, tournamentRoles, dynamicDraws, liveScores] = await Promise.all([
    auth.supabase.rpc("get_category_entries", { category_ids: [] }),
    auth.supabase.rpc("get_league_standings"),
    auth.supabase.from("matches").select("knockout_stage").limit(0),
    auth.supabase.from("category_knockout_previews").select("id").limit(0),
    auth.supabase.rpc("current_actor_profile"),
    auth.supabase.rpc("current_user_access"),
    auth.supabase.rpc("dynamic_draw_capability"),
    auth.supabase.from("live_match_scores").select("match_id").limit(0),
  ])
  for (const error of [entries.error, league.error, knockoutMatches.error, knockoutPreviews.error, organization.error, tournamentRoles.error,dynamicDraws.error,liveScores.error]) {
    if (error && !isMissingFunction(error) && !["42703", "PGRST204", "PGRST205", "42P01"].includes(error.code ?? "")) return databaseReadFailure(error)
  }
  return apiSuccess({ knockout: !knockoutMatches.error && !knockoutPreviews.error, doubles: !entries.error, league: !league.error, organization: !organization.error, tournamentRoles: !tournamentRoles.error,dynamicDraws: !dynamicDraws.error,liveScores:!liveScores.error })
}
