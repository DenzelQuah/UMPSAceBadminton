"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { apiError, type ApiResponse } from "@/lib/apiResponse"
import { requireAuthenticated, requireCommittee } from "@/lib/auth/authorization"
import { orderQualifiers } from "@/lib/tournament/qualification"
import { categoryEntries } from "@/lib/tournament/entries"
import { fisherYatesShuffle } from "@/lib/tournament/draw-engine"
import {
  buildSeededBracket,
  nextBracketSize,
  type BracketPayload,
  type BracketRound,
  type BracketSeed,
} from "@/lib/tournament/bracket"

const categoryIdSchema = z.string().uuid()

type GroupRow = {
  id: string
  name: string
}

type GroupMemberRow = {
  group_id: string
  player_id: string
  matches_played: number
  matches_won: number
  matches_lost: number
  points_won: number
  points_lost: number
  net_points: number
  standings_points: number
  player: { full_name: string } | { full_name: string }[] | null
}

export type KnockoutPreview = {
  id: string
  category_id: string
  qualifier_count: number
  status: "READY" | "PUBLISHED" | "CANCELLED"
  bracket: BracketPayload
  generated_at: string
  published_at: string | null
}

function mapPreview(row: Record<string, unknown>): KnockoutPreview {
  return {
    id: String(row.id),
    category_id: String(row.category_id),
    qualifier_count: Number(row.qualifier_count),
    status: String(row.status) as KnockoutPreview["status"],
    bracket: row.bracket_payload as BracketPayload,
    generated_at: String(row.generated_at),
    published_at: row.published_at ? String(row.published_at) : null,
  }
}

function memberName(value: GroupMemberRow["player"]): string {
  const player = Array.isArray(value) ? value[0] : value
  return player?.full_name ?? "Unknown player"
}

function sameRankingTie(a: GroupMemberRow, b: GroupMemberRow): boolean {
  return (
    a.standings_points === b.standings_points &&
    a.net_points === b.net_points &&
    a.matches_won === b.matches_won &&
    a.matches_lost === b.matches_lost &&
    a.points_won === b.points_won
  )
}

function compareMembers(a: GroupMemberRow, b: GroupMemberRow): number {
  return (
    b.standings_points - a.standings_points ||
    b.net_points - a.net_points ||
    b.matches_won - a.matches_won ||
    a.matches_lost - b.matches_lost ||
    b.points_won - a.points_won ||
    memberName(a.player).localeCompare(memberName(b.player))
  )
}

function toPayload(rounds: BracketRound[], seeds: BracketSeed[], qualifierCount: number): BracketPayload {
  return {
    qualifier_count: qualifierCount,
    bracket_size: nextBracketSize(qualifierCount),
    bye_count: nextBracketSize(qualifierCount)-qualifierCount,
    seeds: seeds.map((seed) => ({
      seed: seed.seed,
      group_name: seed.groupName,
      place: seed.place,
      player_id: seed.playerId,
      player_name: seed.playerName,
    })),
    rounds: rounds.map((round) => ({
      round: round.round,
      label: round.label,
      pairings: round.pairings.map((pairing) => ({
        index: pairing.index,
        player_a_id: pairing.playerAId,
        player_b_id: pairing.playerBId,
        source_pairing_indexes: pairing.sourcePairingIndexes,
        match_id: pairing.matchId,
        bye_player_id: pairing.byePlayerId ?? null,
      })),
    })),
  }
}

function mapRpcError(error: { code?: string; message?: string }): ApiResponse<never> {
  const message = error.message ?? "The knockout bracket could not be prepared."
  if (["P0001", "23505"].includes(error.code ?? "")) {
    return apiError("INVALID_STATE_TRANSITION", 422, message)
  }
  if (["22023", "23514", "22P02", "P0002"].includes(error.code ?? "")) {
    return apiError("VALIDATION_ERROR", 422, message)
  }
  return apiError("DATABASE_ERROR", 500, message)
}

export async function getKnockoutPreview(
  categoryId: string
): Promise<ApiResponse<KnockoutPreview | null>> {
  const auth = await requireAuthenticated()
  if (!auth.ok) return auth.response

  const parsed = categoryIdSchema.safeParse(categoryId)
  if (!parsed.success) return apiError("VALIDATION_ERROR", 400, "Choose a valid category.")

  const { data, error } = await auth.supabase
    .from("category_knockout_previews")
    .select("*")
    .eq("category_id", parsed.data)
    .maybeSingle()

  if (error) {
    if (["42P01", "PGRST202", "42703"].includes(error.code ?? "")) {
      return { success: true, data: null }
    }
    return mapRpcError(error)
  }
  return { success: true, data: data ? mapPreview(data) : null }
}

export async function prepareKnockoutBracket(
  categoryId: string
): Promise<ApiResponse<KnockoutPreview>> {
  const auth = await requireCommittee()
  if (!auth.ok) return auth.response

  const parsed = categoryIdSchema.safeParse(categoryId)
  if (!parsed.success) return apiError("VALIDATION_ERROR", 400, "Choose a valid category.")
  const id = parsed.data

  const [{ data: category, error: categoryError }, { data: categoryMatches, error: matchesError }] =
    await Promise.all([
      auth.supabase
        .from("categories")
        .select("*")
        .eq("id", id)
        .maybeSingle(),
      auth.supabase
        .from("matches")
        .select("id, group_id, status")
        .eq("category_id", id),
    ])

  if (categoryError) return mapRpcError(categoryError)
  if (!category) return apiError("NOT_FOUND", 404, "Category not found.")
  if (matchesError) return mapRpcError(matchesError)

  if (category.draw_format === "SINGLE_ELIMINATION") {
    if (!["REGISTRATION_CLOSED","DRAW_PREPARATION","DRAW_GENERATED"].includes(category.status)) return apiError("INVALID_STATE_TRANSITION",422,"Close registration before preparing the bracket.")
    const [{ data:registrations,error },entries] = await Promise.all([
      auth.supabase.from("registrations").select("player_id,seed_number").eq("category_id",id).eq("status","CONFIRMED"),
      categoryEntries(auth.supabase,[id]),
    ])
    if (error) return mapRpcError(error)
    if (!entries.success) return entries
    if ((registrations?.length ?? 0)<2) return apiError("VALIDATION_ERROR",422,"At least two confirmed entries are required.")
    const names = new Map(entries.data.map((e) => [e.representative_id,e.display_name]))
    const ordered = [
      ...(registrations ?? []).filter((r) => r.seed_number !== null).sort((a,b) => a.seed_number-b.seed_number),
      ...fisherYatesShuffle((registrations ?? []).filter((r) => r.seed_number === null)),
    ]
    if (ordered.some((r) => !names.has(r.player_id))) return apiError("VALIDATION_ERROR",422,"An entry is missing its registered player or pair.")
    const seeds:BracketSeed[] = ordered.map((r,i) => ({ seed:i+1,groupName:"Registered entries",place:i+1,playerId:r.player_id,playerName:names.get(r.player_id)! }))
    const bracket = toPayload(buildSeededBracket(seeds),seeds,seeds.length)
    const { data:preview,error:saveError } = await auth.supabase.rpc("save_category_knockout_preview",{ category_uuid:id,qualifier_count_value:seeds.length,bracket_payload_value:bracket })
    if (saveError || !preview) return mapRpcError(saveError ?? {})
    revalidatePath("/admin","layout")
    return { success:true,data:mapPreview((Array.isArray(preview) ? preview[0] : preview) as Record<string,unknown>) }
  }

  const groupMatches = (categoryMatches ?? []).filter((match) => match.group_id !== null)
  if (groupMatches.length === 0) {
    return apiError("INVALID_STATE_TRANSITION", 422, "Generate and publish the group draw first.")
  }
  if (groupMatches.some((match) => !["COMPLETED", "WALKOVER", "RETIRED"].includes(match.status))) {
    return apiError(
      "INVALID_STATE_TRANSITION",
      422,
      "Every group-stage match must be finalized before reviewing the knockout bracket."
    )
  }

  const { data: groups, error: groupsError } = await auth.supabase
    .from("groups")
    .select("id, name")
    .eq("category_id", id)
    .order("name", { ascending: true })
  if (groupsError) return mapRpcError(groupsError)

  const groupRows = (groups ?? []) as GroupRow[]
  if (groupRows.length !== category.group_count) {
    return apiError("VALIDATION_ERROR", 422, "The published group set is incomplete.")
  }

  const { data: members, error: membersError } = await auth.supabase
    .from("group_members")
    .select(`
      group_id,
      player_id,
      matches_played,
      matches_won,
      matches_lost,
      points_won,
      points_lost,
      net_points,
      standings_points,
      player:profiles!group_members_player_id_fkey(full_name)
    `)
    .in("group_id", groupRows.map((group) => group.id))
  if (membersError) return mapRpcError(membersError)

  const entries = await categoryEntries(auth.supabase, [id])
  if (!entries.success) return entries
  const entryNames = new Map(entries.data.map((entry) => [entry.representative_id, entry.display_name]))
  const seeds: BracketSeed[] = []
  for (const group of groupRows) {
    const groupMembers = ((members ?? []) as GroupMemberRow[])
      .filter((member) => member.group_id === group.id)
      .sort(compareMembers)

    const qualifiers = Math.min(category.qualifiers_per_group,groupMembers.length)

    const boundary = groupMembers[qualifiers - 1]
    const next = groupMembers[qualifiers]
    if (boundary && next && sameRankingTie(boundary, next)) {
      return apiError(
        "VALIDATION_ERROR",
        422,
        `${group.name} has an unresolved tie at the qualification boundary. Resolve it before generating the bracket.`
      )
    }

    for (let place = 1; place <= qualifiers; place += 1) {
      const member = groupMembers[place - 1]
      seeds.push({
        seed: seeds.length + 1,
        groupName: group.name,
        place,
        playerId: member.player_id,
        playerName: entryNames.get(member.player_id) ?? memberName(member.player),
      })
    }
  }

  const qualifierCount = seeds.length

  let rounds: BracketRound[]
  try {
    rounds = buildSeededBracket(orderQualifiers(seeds), qualifierCount)
  } catch (error) {
    return apiError(
      "VALIDATION_ERROR",
      422,
      error instanceof Error ? error.message : "The bracket could not be built."
    )
  }

  const { data: preview, error: previewError } = await auth.supabase.rpc(
    "save_category_knockout_preview",
    {
      category_uuid: id,
      qualifier_count_value: qualifierCount,
      bracket_payload_value: toPayload(rounds, orderQualifiers(seeds), qualifierCount),
    }
  )
  if (previewError || !preview) return mapRpcError(previewError ?? {})

  revalidatePath("/admin", "layout")
  return { success: true, data: mapPreview((Array.isArray(preview) ? preview[0] : preview) as Record<string, unknown>) }
}

export async function publishKnockoutBracket(
  categoryId: string
): Promise<ApiResponse<{ matchCount: number }>> {
  const auth = await requireCommittee()
  if (!auth.ok) return auth.response

  const parsed = categoryIdSchema.safeParse(categoryId)
  if (!parsed.success) return apiError("VALIDATION_ERROR", 400, "Choose a valid category.")

  const { data, error } = await auth.supabase.rpc("publish_category_knockout_bracket", {
    category_uuid: parsed.data,
  })
  if (error) return mapRpcError(error)

  const result = data as { matches?: unknown[] } | null
  revalidatePath("/admin", "layout")
  revalidatePath("/umpire", "layout")
  return { success: true, data: { matchCount: result?.matches?.length ?? 0 } }
}
