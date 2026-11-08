"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { apiError, type ApiResponse } from "@/lib/apiResponse"
import { requireAuthenticated, requireCommittee } from "@/lib/auth/authorization"
import { categoryEntries, nameMatchSides } from "@/lib/tournament/entries"
import { databaseReadFailure, isLegacySinglesSchema, playerRegistrations } from "@/lib/supabase/schema"
import type { Match } from "@/app/(dashboard)/tournaments/types"
import { UPCOMING_MATCH_STATUSES } from "@/lib/tournament/match-status"
import { isPlayerInMatch, scheduledPlayerMatches } from "@/lib/tournament/player-schedule"

const scheduleInputSchema = z.object({
  matchId: z.string().uuid(),
  courtNumber: z.coerce.number().int().min(1).max(100),
  scheduledTime: z.string().min(1),
  umpireId: z.string().uuid().nullable(),
  linesmanId: z.string().uuid().nullable(),
})

export type PlayerStanding = {
  id: string
  group_id: string
  group_name: string
  player_id: string
  player_name: string
  matches_played: number
  matches_won: number
  matches_lost: number
  points_won: number
  points_lost: number
  net_points: number
  standings_points: number
}

function matchFailure(error: { code?: string }): ApiResponse<never> {
  console.error("Match operation failed", { code: error.code })

  if (error.code === "P0001") {
    return apiError(
      "SCHEDULE_CONFLICT",
      409,
      "That allocation conflicts with a court, player, rest, or official assignment."
    )
  }
  if (["22023", "23514", "22P02"].includes(error.code ?? "")) {
    return apiError(
      "VALIDATION_ERROR",
      422,
      "The match schedule or official assignment is invalid."
    )
  }
  if (error.code === "P0002") {
    return apiError("NOT_FOUND", 404, "The match could not be found.")
  }
  return apiError(
    "DATABASE_ERROR",
    500,
    "The match could not be updated. No partial changes were saved."
  )
}

function mapMatch(row: Record<string, unknown>): Match {
  const relation = (key: string) => {
    const value = row[key]
    return (Array.isArray(value) ? value[0] : value) as
      | { full_name?: string }
      | null
  }
  const playerA = relation("player_a")
  const playerB = relation("player_b")
  const umpire = relation("umpire")
  const linesman = relation("linesman")
  const categoryRelation = Array.isArray(row.category) ? row.category[0] : row.category
  const category = categoryRelation as { name?:string; status?:string; tournament?: { id?:string; title?:string; location?:string; status?:string } | Array<{ id?:string; title?:string; location?:string; status?:string }> } | null
  const tournament = Array.isArray(category?.tournament) ? category.tournament[0] : category?.tournament

  return {
    id: String(row.id),
    tournament_id: tournament?.id,
    category_id: String(row.category_id),
    group_id: row.group_id ? String(row.group_id) : null,
    group_round: row.group_round ? Number(row.group_round) : null,
    knockout_round: row.knockout_round ? Number(row.knockout_round) : null,
    knockout_stage: row.knockout_stage ? String(row.knockout_stage) : null,
    player_a_id: String(row.player_a_id),
    player_b_id: String(row.player_b_id),
    player_a_partner_id: row.player_a_partner_id ? String(row.player_a_partner_id) : null,
    player_b_partner_id: row.player_b_partner_id ? String(row.player_b_partner_id) : null,
    status: String(row.status),
    court_number: row.court_number ? Number(row.court_number) : null,
    scheduled_time: row.scheduled_time
      ? String(row.scheduled_time)
      : null,
    estimated_start_time: row.estimated_start_time
      ? String(row.estimated_start_time)
      : null,
    umpire_id: row.umpire_id ? String(row.umpire_id) : null,
    linesman_id: row.linesman_id ? String(row.linesman_id) : null,
    winner_id: row.winner_id ? String(row.winner_id) : null,
    created_at: String(row.created_at),
    player_a_name: playerA?.full_name,
    player_b_name: playerB?.full_name,
    umpire_name: umpire?.full_name,
    linesman_name: linesman?.full_name,
    category_name: category?.name,
    category_status: category?.status,
    tournament_title: tournament?.title,
    tournament_location: tournament?.location,
    tournament_status: tournament?.status,
  }
}

export async function getCategoryMatches(
  categoryId: string
): Promise<ApiResponse<Match[]>> {
  const auth = await requireAuthenticated()
  if (!auth.ok) return auth.response

  const { data, error } = await auth.supabase
    .from("matches")
    .select(`
      *,
      player_a:profiles!matches_player_a_id_fkey(full_name),
      player_b:profiles!matches_player_b_id_fkey(full_name),
      umpire:profiles!matches_umpire_id_fkey(full_name),
      linesman:profiles!matches_linesman_id_fkey(full_name)
    `)
    .eq("category_id", categoryId)
    .order("scheduled_time", { ascending: true, nullsFirst: false })

  if (error) {
    console.error("Category match lookup failed", { code: error.code })
    return apiError(
      "DATABASE_ERROR",
      500,
      "Matches could not be loaded."
    )
  }

  return nameMatchSides(auth.supabase, ((data ?? []) as Record<string, unknown>[]).map(mapMatch))
}

async function loadPlayerMatches(upcomingOnly:boolean): Promise<ApiResponse<Match[]>> {
  const auth = await requireAuthenticated()
  if (!auth.ok) return auth.response

  const query = (includePartners: boolean) => {
    let request = auth.supabase
    .from("matches")
    .select(`
      *,
      player_a:profiles!matches_player_a_id_fkey(full_name),
      player_b:profiles!matches_player_b_id_fkey(full_name),
      category:categories!matches_category_id_fkey(name,status,tournament:tournaments!categories_tournament_id_fkey(id,title,location,status))
    `)
    .or(`player_a_id.eq.${auth.userId},player_b_id.eq.${auth.userId}${includePartners ? `,player_a_partner_id.eq.${auth.userId},player_b_partner_id.eq.${auth.userId}` : ""}`)
    if (upcomingOnly) request = request.in("status",[...UPCOMING_MATCH_STATUSES])
    return request.order("scheduled_time", { ascending: true, nullsFirst: false })
  }

  let { data, error } = await query(true)
  if (error && ["42703", "PGRST204"].includes(error.code)) {
    const legacy = await isLegacySinglesSchema(auth.supabase)
    if (!legacy.success) return legacy
    if (!legacy.data) return databaseReadFailure(error)
    const fallback = await query(false)
    data = fallback.data
    error = fallback.error
  }
  if (error) {
    console.error("Player match lookup failed", { code: error.code })
    return apiError(
      "DATABASE_ERROR",
      500,
      "Your matches could not be loaded."
    )
  }

  const ownMatches = ((data ?? []) as Record<string,unknown>[]).map(mapMatch).filter((match) => isPlayerInMatch(match,auth.userId))
  return nameMatchSides(auth.supabase, upcomingOnly ? scheduledPlayerMatches(ownMatches,auth.userId) : ownMatches)
}

export async function getPlayerMatches(): Promise<ApiResponse<Match[]>> {
  return loadPlayerMatches(false)
}

export async function getUpcomingPlayerMatches(): Promise<ApiResponse<Match[]>> {
  return loadPlayerMatches(true)
}

export async function getPlayerStandings(): Promise<
  ApiResponse<PlayerStanding[]>
> {
  const auth = await requireAuthenticated()
  if (!auth.ok) return auth.response

  const registrations = await playerRegistrations(auth.supabase, auth.userId)
  if (!registrations.success) return registrations
  const ownRegistrations = registrations.data
  const representativeIds = [...new Set([auth.userId, ...ownRegistrations.map((r) => r.player_id)])]
  const { data: membership, error: membershipError } = await auth.supabase
    .from("group_members")
    .select("group_id, player_id, group:groups!group_members_group_id_fkey(name, category_id)")
    .in("player_id", representativeIds)

  if (membershipError) {
    console.error("Player group lookup failed", { code: membershipError.code })
    return apiError(
      "DATABASE_ERROR",
      500,
      "Your group standings could not be loaded."
    )
  }

  const groupIds = (membership ?? []).filter((row) => {
    if (row.player_id === auth.userId) return true
    const group = Array.isArray(row.group) ? row.group[0] : row.group
    return ownRegistrations.some((r) => r.player_id === row.player_id && r.category_id === group?.category_id)
  }).map((row) => row.group_id)
  if (groupIds.length === 0) return { success: true, data: [] }

  const { data, error } = await auth.supabase
    .from("group_members")
    .select(`
      id,
      group_id,
      player_id,
      matches_played,
      matches_won,
      matches_lost,
      points_won,
      points_lost,
      net_points,
      standings_points,
      player:profiles(full_name),
      group:groups!group_members_group_id_fkey(name, category_id)
    `)
    .in("group_id", groupIds)
    .order("standings_points", { ascending: false })
    .order("net_points", { ascending: false })

  if (error) {
    console.error("Player standings lookup failed", { code: error.code })
    return apiError(
      "DATABASE_ERROR",
      500,
      "Your group standings could not be loaded."
    )
  }

  const entries = await categoryEntries(auth.supabase, (membership ?? []).flatMap((row) => {
    const group = Array.isArray(row.group) ? row.group[0] : row.group
    return group?.category_id ? [group.category_id] : []
  }))
  if (!entries.success) return entries
  const names = new Map(entries.data.map((entry) => [`${entry.category_id}:${entry.representative_id}`, entry.display_name]))
  return {
    success: true,
    data: (data ?? []).map((row) => {
      const player = Array.isArray(row.player) ? row.player[0] : row.player
      const group = Array.isArray(row.group) ? row.group[0] : row.group
      return {
        id: row.id,
        group_id: row.group_id,
        group_name: group?.name ?? "Group",
        player_id: row.player_id,
        player_name: names.get(`${group?.category_id}:${row.player_id}`) ?? player?.full_name ?? "Player",
        matches_played: row.matches_played,
        matches_won: row.matches_won,
        matches_lost: row.matches_lost,
        points_won: row.points_won,
        points_lost: row.points_lost,
        net_points: row.net_points,
        standings_points: row.standings_points,
      }
    }),
  }
}

export async function scheduleMatch(
  payload: z.input<typeof scheduleInputSchema>
): Promise<
  ApiResponse<{
    matchId: string
    courtNumber: number
    scheduledTime: string
  }>
> {
  const auth = await requireCommittee()
  if (!auth.ok) return auth.response

  const parsed = scheduleInputSchema.safeParse(payload)
  if (!parsed.success || !Number.isFinite(Date.parse(parsed.data?.scheduledTime ?? ""))) {
    return apiError(
      "VALIDATION_ERROR",
      400,
      "Choose a valid court, date, time, and official assignment."
    )
  }

  const { data, error } = await auth.supabase.rpc("schedule_match", {
    match_uuid: parsed.data.matchId,
    court_value: parsed.data.courtNumber,
    start_time: new Date(parsed.data.scheduledTime).toISOString(),
    umpire_uuid: parsed.data.umpireId,
    linesman_uuid: parsed.data.linesmanId,
  })
  const result = Array.isArray(data) ? data[0] : data

  if (error || !result) return matchFailure(error ?? {})
  revalidatePath("/admin", "layout")
  revalidatePath("/matches")
  revalidatePath("/tournaments/[tournamentId]","page")
  revalidatePath("/umpire")
  return {
    success: true,
    data: {
      matchId: result.id,
      courtNumber: result.court_number,
      scheduledTime: result.scheduled_time,
    },
  }
}

export async function getRecentCommitteeActivity(): Promise<
  ApiResponse<
    Array<{
      id: string
      action: string
      entity_type: string
      entity_id: string | null
      reason: string | null
      created_at: string
    }>
  >
> {
  const auth = await requireCommittee()
  if (!auth.ok) return auth.response

  const { data, error } = await auth.supabase
    .from("audit_logs")
    .select("id, action, entity_type, entity_id, reason, created_at")
    .order("created_at", { ascending: false })
    .limit(8)

  if (error) {
    console.error("Committee activity lookup failed", { code: error.code })
    return apiError(
      "DATABASE_ERROR",
      500,
      "Recent committee activity could not be loaded."
    )
  }

  return { success: true, data: (data ?? []) as never[] }
}
