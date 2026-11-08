import "server-only"
import type { createClient } from "@/lib/supabase/server"
import type { Match } from "@/app/(dashboard)/tournaments/types"
import { apiSuccess, type ApiResponse } from "@/lib/apiResponse"
import { databaseReadFailure, isLegacySinglesSchema, isMissingFunction } from "@/lib/supabase/schema"

export type Entry = { category_id: string; representative_id: string; partner_id: string | null; display_name: string }
type Client = Awaited<ReturnType<typeof createClient>>

export async function categoryEntries(client: Client, categoryIds: string[]): Promise<ApiResponse<Entry[]>> {
  if (categoryIds.length === 0) return apiSuccess([])
  const { data, error } = await client.rpc("get_category_entries", { category_ids: [...new Set(categoryIds)] })
  if (!error) return apiSuccess((data ?? []) as Entry[])
  if (!isMissingFunction(error)) return databaseReadFailure(error)
  const legacy = await isLegacySinglesSchema(client)
  if (!legacy.success) return legacy
  if (!legacy.data) return databaseReadFailure(error)
  const fallback = await client.from("registrations")
    .select("category_id, player_id, player:profiles!registrations_player_id_fkey(full_name)")
    .in("category_id", [...new Set(categoryIds)]).neq("status", "WITHDRAWN")
  if (fallback.error) return databaseReadFailure(fallback.error)
  return apiSuccess((fallback.data ?? []).map((row) => {
    const profile = Array.isArray(row.player) ? row.player[0] : row.player
    return { category_id: row.category_id, representative_id: row.player_id, partner_id: null, display_name: profile?.full_name ?? "Player" }
  }))
}

export async function nameMatchSides(client: Client, matches: Match[]): Promise<ApiResponse<Match[]>> {
  const entries = await categoryEntries(client, matches.map((match) => match.category_id))
  if (!entries.success) return entries
  const names = new Map(entries.data.map((entry) => [`${entry.category_id}:${entry.representative_id}`, entry.display_name]))
  return apiSuccess(matches.map((match) => ({ ...match,
    player_a_name: names.get(`${match.category_id}:${match.player_a_id}`) ?? match.player_a_name,
    player_b_name: names.get(`${match.category_id}:${match.player_b_id}`) ?? match.player_b_name,
  })))
}
