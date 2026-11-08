"use server"

import { categoryEntries, nameMatchSides } from "@/lib/tournament/entries"

import { z } from "zod"

import { apiError, type ApiResponse } from "@/lib/apiResponse"
import { requireAuthenticated, requireCommittee } from "@/lib/auth/authorization"
import { getCurrentUserWithRoles } from "@/app/actions/user"
import type { Match } from "@/app/(dashboard)/tournaments/types"
import {
  validateGameScore,
  type GameScore,
  type ScoringFormat,
} from "@/lib/tournament/scoring"
import { ASSIGNED_MATCH_STATUSES } from "@/lib/tournament/match-status"
import { liveScoreSchema,type LiveScore,type PointCommand } from "@/lib/realtime/live-scores"
import { databaseReadFailure } from "@/lib/supabase/schema"

export type MatchOperationData = {
  match: Match & {
    format: ScoringFormat
    player_a_name?: string
    player_b_name?: string
    umpire_name?: string
    linesman_name?: string
  }
  games: GameScore[]
  events: Array<{
    id: string
    event_type: string
    event_time: string
    player_id: string | null
    card: "YELLOW" | "RED" | "BLACK" | null
  }>
}

const scoreSchema = z.object({
  matchId: z.string().uuid(),
  gameNumber: z.number().int().min(1).max(3),
  playerAScore: z.number().int().min(0).max(30),
  playerBScore: z.number().int().min(0).max(30),
})

const cardSchema = z.object({
  matchId: z.string().uuid(),
  card: z.enum(["YELLOW", "RED", "BLACK"]),
  playerId: z.string().uuid().nullable().optional(),
})

function operationFailure(error: { code?: string; message?: string }): ApiResponse<never> {
  console.error("Match operation failed", { code: error.code })
  if (error.code === "42501") {
    return apiError(
      "AUTH_FORBIDDEN",
      403,
      "You are not assigned to this match or do not have committee access."
    )
  }
  if (error.code === "P0001") {
    return apiError(
      "INVALID_STATE_TRANSITION",
      422,
      "This match is not in a state where that operation is allowed."
    )
  }
  if (["22023", "23514", "22P02"].includes(error.code ?? "")) {
    return apiError(
      "VALIDATION_ERROR",
      422,
      error.message?.startsWith("Override")
        ? error.message
        : "The score or discipline entry is invalid for this match."
    )
  }
  if (error.code === "P0002") {
    return apiError("NOT_FOUND", 404, "The match could not be found.")
  }
  return apiError(
    "DATABASE_ERROR",
    500,
    "The match operation could not be completed. No partial changes were saved."
  )
}

function mapGames(rows: Array<Record<string, unknown>>): GameScore[] {
  return rows.map((row) => ({
    gameNumber: Number(row.game_number),
    playerAScore: Number(row.player_a_score),
    playerBScore: Number(row.player_b_score),
  }))
}

export async function getAssignedMatches(): Promise<ApiResponse<Match[]>> {
  const auth = await requireAuthenticated()
  if (!auth.ok) return auth.response

  const user = await getCurrentUserWithRoles()
  const isAdmin = user?.roles.isOrganizer === true

  let matchQuery = auth.supabase
    .from("matches")
    .select(`
      *,
      category:categories!matches_category_id_fkey(format),
      player_a:profiles!matches_player_a_id_fkey(full_name),
      player_b:profiles!matches_player_b_id_fkey(full_name),
      umpire:profiles!matches_umpire_id_fkey(full_name)
    `)
    // Keep terminal matches visible so an official can reopen the read-only
    // scoring console after submitting a result or after a correction.
    .in("status", [...ASSIGNED_MATCH_STATUSES])

  // Administrators may open any published match console. Everyone else only
  // sees matches where they are the assigned umpire.
  if (!isAdmin) {
    matchQuery = matchQuery.or(`umpire_id.eq.${auth.userId},linesman_id.eq.${auth.userId}`)
  }

  const { data, error } = await matchQuery.order("scheduled_time", {
    ascending: true,
    nullsFirst: false,
  })

  if (error) {
    console.error("Assigned match lookup failed", { code: error.code })
    return apiError("DATABASE_ERROR", 500, "Assigned matches could not be loaded.")
  }

  return nameMatchSides(auth.supabase, ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id),
      category_id: String(row.category_id),
      group_id: row.group_id ? String(row.group_id) : null,
      knockout_round: row.knockout_round ? Number(row.knockout_round) : null,
      knockout_stage: row.knockout_stage ? String(row.knockout_stage) : null,
      player_a_id: String(row.player_a_id),
      player_b_id: String(row.player_b_id),
      status: String(row.status),
      court_number: row.court_number ? Number(row.court_number) : null,
      scheduled_time: row.scheduled_time ? String(row.scheduled_time) : null,
      estimated_start_time: row.estimated_start_time ? String(row.estimated_start_time) : null,
      umpire_id: row.umpire_id ? String(row.umpire_id) : null,
      linesman_id: row.linesman_id ? String(row.linesman_id) : null,
      winner_id: row.winner_id ? String(row.winner_id) : null,
      created_at: String(row.created_at),
      player_a_name: (Array.isArray(row.player_a) ? row.player_a[0] : row.player_a)?.full_name,
      player_b_name: (Array.isArray(row.player_b) ? row.player_b[0] : row.player_b)?.full_name,
      umpire_name: (Array.isArray(row.umpire) ? row.umpire[0] : row.umpire)?.full_name,
    })))
}

export async function getMatchForOperator(
  matchId: string
): Promise<ApiResponse<MatchOperationData>> {
  const auth = await requireAuthenticated()
  if (!auth.ok) return auth.response

  const [matchResult, gamesResult, eventsResult, user] = await Promise.all([
    auth.supabase
      .from("matches")
      .select(`
        *,
        category:categories!matches_category_id_fkey(format),
        player_a:profiles!matches_player_a_id_fkey(full_name),
        player_b:profiles!matches_player_b_id_fkey(full_name),
        umpire:profiles!matches_umpire_id_fkey(full_name),
        linesman:profiles!matches_linesman_id_fkey(full_name)
      `)
      .eq("id", matchId)
      .maybeSingle(),
    auth.supabase
      .from("match_games")
      .select("game_number, player_a_score, player_b_score")
      .eq("match_id", matchId)
      .order("game_number"),
    auth.supabase
      .from("match_events")
      .select("id, event_type, event_time, player_id, card")
      .eq("match_id", matchId)
      .order("event_time", { ascending: true }),
    getCurrentUserWithRoles(),
  ])

  if (matchResult.error || !matchResult.data) {
    return operationFailure(matchResult.error ?? { code: "P0002" })
  }
  if (gamesResult.error) return operationFailure(gamesResult.error)
  if (eventsResult.error) return operationFailure(eventsResult.error)
  if (!user || (!user.roles.isOrganizer && (!user.roles.isUmpire || matchResult.data.umpire_id !== auth.userId))) {
    return apiError(
      "AUTH_FORBIDDEN",
      403,
      "You are not assigned to this match."
    )
  }

  const category = Array.isArray(matchResult.data.category)
    ? matchResult.data.category[0]
    : matchResult.data.category
  const playerA = Array.isArray(matchResult.data.player_a)
    ? matchResult.data.player_a[0]
    : matchResult.data.player_a
  const playerB = Array.isArray(matchResult.data.player_b)
    ? matchResult.data.player_b[0]
    : matchResult.data.player_b
  const umpire = Array.isArray(matchResult.data.umpire)
    ? matchResult.data.umpire[0]
    : matchResult.data.umpire
  const linesman = Array.isArray(matchResult.data.linesman)
    ? matchResult.data.linesman[0]
    : matchResult.data.linesman
  const row = matchResult.data as Record<string, unknown>

  const entries = await categoryEntries(auth.supabase, [String(row.category_id)])
  if (!entries.success) return entries
  const names = new Map(entries.data.map((entry) => [entry.representative_id, entry.display_name]))

  return {
    success: true,
    data: {
      match: {
        id: String(row.id),
        category_id: String(row.category_id),
        group_id: row.group_id ? String(row.group_id) : null,
        knockout_round: row.knockout_round ? Number(row.knockout_round) : null,
      knockout_stage: row.knockout_stage ? String(row.knockout_stage) : null,
        player_a_id: String(row.player_a_id),
        player_b_id: String(row.player_b_id),
        status: String(row.status),
        court_number: row.court_number ? Number(row.court_number) : null,
        scheduled_time: row.scheduled_time ? String(row.scheduled_time) : null,
        estimated_start_time: row.estimated_start_time ? String(row.estimated_start_time) : null,
        umpire_id: row.umpire_id ? String(row.umpire_id) : null,
        linesman_id: row.linesman_id ? String(row.linesman_id) : null,
        winner_id: row.winner_id ? String(row.winner_id) : null,
        created_at: String(row.created_at),
        format: (category?.format ?? "STANDARD_3X21") as ScoringFormat,
        player_a_name: names.get(String(row.player_a_id)) ?? playerA?.full_name,
        player_b_name: names.get(String(row.player_b_id)) ?? playerB?.full_name,
        umpire_name: umpire?.full_name,
        linesman_name: linesman?.full_name,
      },
      games: mapGames((gamesResult.data ?? []) as Array<Record<string, unknown>>),
      events: (eventsResult.data ?? []) as MatchOperationData["events"],
    },
  }
}

export async function startMatch(matchId: string): Promise<ApiResponse<void>> {
  const auth = await requireAuthenticated()
  if (!auth.ok) return auth.response
  const { error } = await auth.supabase.rpc("start_match", { match_uuid: matchId })
  if (error) return operationFailure(error)
  return { success: true, data: undefined }
}

export async function adjustMatchPoint(payload:PointCommand):Promise<ApiResponse<LiveScore>> {
  const auth=await requireAuthenticated()
  if(!auth.ok)return auth.response
  const input=z.object({matchId:z.string().uuid(),gameNumber:z.number().int().min(1).max(3),side:z.enum(["a","b"]),delta:z.union([z.literal(1),z.literal(-1)]),expectedVersion:z.number().int().positive(),operationId:z.string().uuid()}).safeParse(payload)
  if(!input.success)return apiError("VALIDATION_ERROR",400,"Choose a valid single-point change.")
  const p=input.data
  const {data,error}=await auth.supabase.rpc("adjust_match_point",{match_uuid:p.matchId,game_number_value:p.gameNumber,side_value:p.side,delta_value:p.delta,expected_version:p.expectedVersion,operation_uuid:p.operationId})
  if(error?.code==="40001")return apiError("SCORE_CONFLICT",409,"The score changed on another device. The latest saved score must be loaded before continuing.")
  if(error?.code==="PGRST202")return databaseReadFailure(error)
  if(error)return operationFailure(error)
  const parsed=liveScoreSchema.safeParse(Array.isArray(data) ? data[0]:data)
  return parsed.success ? {success:true,data:parsed.data} : apiError("DATABASE_ERROR",500,"The saved point could not be verified. Reconnect before continuing.")
}

export async function recordGameScore(
  payload: z.input<typeof scoreSchema>
): Promise<ApiResponse<{ gameNumber: number; playerAScore: number; playerBScore: number }>> {
  const auth = await requireAuthenticated()
  if (!auth.ok) return auth.response
  const parsed = scoreSchema.safeParse(payload)
  if (!parsed.success) {
    return apiError("VALIDATION_ERROR", 400, "Enter valid whole-number scores.")
  }

  const { data: matchRow, error: matchError } = await auth.supabase
    .from("matches")
    .select("category_id")
    .eq("id", parsed.data.matchId)
    .maybeSingle()
  if (matchError || !matchRow) return operationFailure(matchError ?? { code: "P0002" })

  const { data: category, error: categoryError } = await auth.supabase
    .from("categories")
    .select("format")
    .eq("id", matchRow.category_id)
    .maybeSingle()
  if (categoryError || !category) return operationFailure(categoryError ?? { code: "P0002" })

  const validation = validateGameScore(
    category.format as ScoringFormat,
    parsed.data.gameNumber,
    parsed.data.playerAScore,
    parsed.data.playerBScore
  )
  if (!validation.valid) return apiError("VALIDATION_ERROR", 422, validation.message)

  const { data, error } = await auth.supabase.rpc("record_game_score", {
    match_uuid: parsed.data.matchId,
    game_number_value: parsed.data.gameNumber,
    player_a_value: parsed.data.playerAScore,
    player_b_value: parsed.data.playerBScore,
  })
  const game = Array.isArray(data) ? data[0] : data
  if (error || !game) return operationFailure(error ?? {})
  return {
    success: true,
    data: {
      gameNumber: game.game_number,
      playerAScore: game.player_a_score,
      playerBScore: game.player_b_score,
    },
  }
}

export async function submitMatchResult(matchId: string): Promise<ApiResponse<{ winnerId: string }>> {
  const auth = await requireAuthenticated()
  if (!auth.ok) return auth.response
  const { data, error } = await auth.supabase.rpc("submit_match_result", {
    match_uuid: matchId,
  })
  const result = Array.isArray(data) ? data[0] : data
  if (error || !result) return operationFailure(error ?? {})
  return { success: true, data: { winnerId: result.winner_id } }
}

export async function logDisciplinaryCard(
  payload: z.input<typeof cardSchema>
): Promise<ApiResponse<void>> {
  const auth = await requireAuthenticated()
  if (!auth.ok) return auth.response
  const parsed = cardSchema.safeParse(payload)
  if (!parsed.success) return apiError("VALIDATION_ERROR", 400, "Choose a valid card and player.")

  const { error } = await auth.supabase.rpc("log_disciplinary_card", {
    match_uuid: parsed.data.matchId,
    card_value: parsed.data.card,
    player_uuid: parsed.data.playerId ?? null,
  })
  if (error) return operationFailure(error)
  return { success: true, data: undefined }
}

export async function overrideMatchResult(payload: {
  matchId: string
  status: "COMPLETED" | "WALKOVER" | "RETIRED" | "CANCELLED" | "POSTPONED" | "IN_PROGRESS"
  winnerId: string | null
  scores: Array<{ gameNumber: number; playerAScore: number; playerBScore: number }>
  reason: string
}): Promise<ApiResponse<void>> {
  const auth = await requireCommittee()
  if (!auth.ok) return auth.response
  if (payload.reason.trim().length < 10) {
    return apiError("VALIDATION_ERROR", 422, "Provide a reason of at least 10 characters.")
  }
  const { error } = await auth.supabase.rpc("override_match_result", {
    match_uuid: payload.matchId,
    new_status_value: payload.status,
    new_winner_id: payload.winnerId,
    scores_payload: payload.scores.map((score) => ({
      game_number: score.gameNumber,
      player_a_score: score.playerAScore,
      player_b_score: score.playerBScore,
    })),
    reason_text: payload.reason.trim(),
  })
  if (error) return operationFailure(error)
  return { success: true, data: undefined }
}
