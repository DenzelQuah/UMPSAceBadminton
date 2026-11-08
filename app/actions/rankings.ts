"use server"

import { apiError, type ApiResponse } from "@/lib/apiResponse"
import { requireAuthenticated } from "@/lib/auth/authorization"
import { databaseReadFailure, isMissingFunction } from "@/lib/supabase/schema"

export type GlobalRanking = {
  rank_position: number
  profile_id: string
  full_name: string
  ranking_points: number
  net_points: number
  matches_won: number
  matches_played: number
  matches_lost: number
  games_won: number
  points_won: number
  points_lost: number
  participations: number
  win_percentage: number
  recent_form: ("W" | "L")[]
}

export async function getGlobalRankings(): Promise<ApiResponse<GlobalRanking[]>> {
  const auth = await requireAuthenticated()
  if (!auth.ok) return auth.response

  const { data, error } = await auth.supabase.rpc("get_league_standings")
  if (error) {
    if (isMissingFunction(error)) return databaseReadFailure(error)
    console.error("Global rankings lookup failed", { code: error.code })
    return apiError(
      "DATABASE_ERROR",
      500,
      "The leaderboard could not be loaded right now."
    )
  }

  return { success: true, data: (data ?? []) as GlobalRanking[] }
}
