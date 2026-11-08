"use server"

import { categoryEntries } from "@/lib/tournament/entries"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { apiError, type ApiResponse } from "@/lib/apiResponse"
import { requireAuthenticated, requireCommittee } from "@/lib/auth/authorization"
import {
  distributePlayers,
  dynamicGroupCount,
  generateRoundRobinMatches,
  validateDrawCoverage,
  type Group,
} from "@/lib/tournament/draw-engine"
import type { Category, Tournament } from "@/app/(dashboard)/tournaments/types"

const tournamentInputSchema = z
  .object({
    title: z.string().trim().min(3).max(255),
    description: z.string().trim().max(3000).optional(),
    location: z.string().trim().min(2).max(255),
    court_count: z.coerce.number().int().min(1).max(100),
    start_date: z.string().min(1),
    end_date: z.string().min(1),
  })
  .refine(
    ({ start_date, end_date }) =>
      Number.isFinite(Date.parse(start_date)) &&
      Number.isFinite(Date.parse(end_date)) &&
      new Date(start_date) <= new Date(end_date),
    {
      message: "End date must be on or after the start date.",
      path: ["end_date"],
    }
  )

export type DrawPreview = {
  id: string
  category_id: string
  groups: Group[]
  matchesCount: number
  status: "READY" | "PUBLISHED" | "CANCELLED"
  generated_at: string
  published_at: string | null
}

export type CommitteeOverview = {
  tournamentCount: number
  openCategoryCount: number
  confirmedPlayerCount: number
  unscheduledMatchCount: number
  liveMatchCount: number
}

function mapDatabaseFailure(error: { code?: string; message?: string }): ApiResponse<never> {
  console.error("Tournament database operation failed", { code: error.code })

  if (error.code === "P0002") {
    return apiError("NOT_FOUND", 404, "The requested tournament record could not be found.")
  }
  if (["P0001", "23505"].includes(error.code ?? "")) {
    return apiError(
      "INVALID_STATE_TRANSITION",
      422,
      "This tournament step is no longer available. Refresh and review the current stage."
    )
  }
  if (["22023", "23514", "22P02"].includes(error.code ?? "")) {
    return apiError(
      "VALIDATION_ERROR",
      422,
      "Some draw or tournament data is invalid. Review the roster and try again."
    )
  }
  return apiError(
    "DATABASE_ERROR",
    500,
    "The tournament could not be updated. No partial changes were saved."
  )
}

export async function createTournament(
  payload: z.input<typeof tournamentInputSchema>
): Promise<ApiResponse<Tournament>> {
  const auth = await requireCommittee()
  if (!auth.ok) return auth.response

  const parsed = tournamentInputSchema.safeParse(payload)
  if (!parsed.success) {
    return apiError(
      "VALIDATION_ERROR",
      400,
      parsed.error.issues[0]?.message ?? "Review the tournament details."
    )
  }

  const { data, error } = await auth.supabase
    .from("tournaments")
    .insert({
      title: parsed.data.title,
      description: parsed.data.description || null,
      location: parsed.data.location,
      court_count: parsed.data.court_count,
      start_date: new Date(parsed.data.start_date).toISOString(),
      end_date: new Date(parsed.data.end_date).toISOString(),
    })
    .select()
    .single()

  if (error || !data) return mapDatabaseFailure(error ?? {})

  revalidatePath("/admin", "layout")
  revalidatePath("/tournaments")
  revalidatePath("/dashboard")
  return { success: true, data: data as Tournament }
}

export async function getAdminTournaments(): Promise<ApiResponse<Tournament[]>> {
  const auth = await requireCommittee()
  if (!auth.ok) return auth.response

  const { data, error } = await auth.supabase
    .from("tournaments")
    .select("*")
    .order("start_date", { ascending: true })

  if (error) return mapDatabaseFailure(error)
  return { success: true, data: (data ?? []) as Tournament[] }
}

export async function getVisibleTournaments(): Promise<ApiResponse<Tournament[]>> {
  const auth = await requireAuthenticated()
  if (!auth.ok) return auth.response
  // RLS controls draft visibility; managers see drafts and players only see
  // published/open or own-registration records. Do not filter out new drafts.
  const { data, error } = await auth.supabase.from("tournaments").select("*").order("created_at", { ascending: false })
  if (error) return mapDatabaseFailure(error)
  return { success: true, data: (data ?? []) as Tournament[] }
}

export async function getCommitteeOverview(): Promise<
  ApiResponse<CommitteeOverview>
> {
  const auth = await requireCommittee()
  if (!auth.ok) return auth.response

  const [tournamentsResult, categoriesResult, registrationsResult, matchesResult] =
    await Promise.all([
      auth.supabase.from("tournaments").select("id", { count: "exact", head: true }),
      auth.supabase
        .from("categories")
        .select("id", { count: "exact", head: true })
        .eq("status", "REGISTRATION_OPEN"),
      auth.supabase
        .from("registrations")
        .select("id", { count: "exact", head: true })
        .eq("status", "CONFIRMED"),
      auth.supabase
        .from("matches")
        .select("id, scheduled_time, status", { count: "exact" }),
    ])

  const firstError =
    tournamentsResult.error ??
    categoriesResult.error ??
    registrationsResult.error ??
    matchesResult.error
  if (firstError) return mapDatabaseFailure(firstError)

  const matches = matchesResult.data ?? []
  return {
    success: true,
    data: {
      tournamentCount: tournamentsResult.count ?? 0,
      openCategoryCount: categoriesResult.count ?? 0,
      confirmedPlayerCount: registrationsResult.count ?? 0,
      unscheduledMatchCount: matches.filter(
        (match) => match.scheduled_time === null
      ).length,
      liveMatchCount: matches.filter((match) => match.status === "IN_PROGRESS")
        .length,
    },
  }
}

export async function getTournament(id: string): Promise<ApiResponse<Tournament>> {
  const auth = await requireAuthenticated()
  if (!auth.ok) return auth.response

  const { data, error } = await auth.supabase
    .from("tournaments")
    .select("*")
    .eq("id", id)
    .maybeSingle()

  if (error) return mapDatabaseFailure(error)
  if (!data) {
    return apiError("NOT_FOUND", 404, "Tournament not found.")
  }
  return { success: true, data: data as Tournament }
}

export async function generateTournamentDraw(categoryId: string): Promise<
  ApiResponse<{
    preview: DrawPreview
    matchesCount: number
  }>
> {
  const auth = await requireCommittee()
  if (!auth.ok) return auth.response

  const { data: category, error: categoryError } = await auth.supabase
    .from("categories")
    .select("*")
    .eq("id", categoryId)
    .maybeSingle()

  if (categoryError) return mapDatabaseFailure(categoryError)
  if (!category) {
    return apiError("NOT_FOUND", 404, "Category not found.")
  }
  if (!["REGISTRATION_CLOSED", "DRAW_PREPARATION", "DRAW_GENERATED"].includes(category.status)) {
    return apiError(
      "INVALID_STATE_TRANSITION",
      422,
      "Close registration before generating a draw preview."
    )
  }

  const { data: registrations, error: registrationError } = await auth.supabase
    .from("registrations")
    .select("player_id, seed_number, player:profiles!registrations_player_id_fkey(id, full_name)")
    .eq("category_id", categoryId)
    .eq("status", "CONFIRMED")

  if (registrationError) return mapDatabaseFailure(registrationError)

  const entries = await categoryEntries(auth.supabase, [categoryId])
  if (!entries.success) return entries
  const entryNames = new Map(entries.data.map((entry) => [entry.representative_id, entry.display_name]))
  const players = (registrations ?? []).flatMap((registration) => {
    const player = Array.isArray(registration.player)
      ? registration.player[0]
      : registration.player
    return player
      ? [
          {
            id: player.id,
            full_name: entryNames.get(player.id) ?? player.full_name,
            seed_number: registration.seed_number,
          },
        ]
      : []
  })

  if (players.length !== (registrations?.length ?? 0)) {
    return apiError(
      "VALIDATION_ERROR",
      422,
      "One or more registrations no longer has a valid player profile."
    )
  }

  let groups: Group[]
  let matchesCount: number
  try {
    if (category.draw_format === "SINGLE_ELIMINATION") throw new Error("Prepare the elimination bracket for this category.")
    groups = distributePlayers(players, dynamicGroupCount(players.length,category.target_group_size ?? Math.max(2,Math.ceil(category.max_capacity/category.group_count)),category.qualifiers_per_group))
    validateDrawCoverage(players, groups)
    matchesCount = generateRoundRobinMatches(groups).length
  } catch (error) {
    return apiError(
      "VALIDATION_ERROR",
      422,
      error instanceof Error ? error.message : "The draw could not be generated."
    )
  }

  const { data: previewData, error: previewError } = await auth.supabase.rpc(
    "save_category_draw_preview",
    { category_uuid: categoryId, groups_payload: groups }
  )
  const preview = Array.isArray(previewData) ? previewData[0] : previewData

  if (previewError || !preview) return mapDatabaseFailure(previewError ?? {})

  revalidatePath("/admin", "layout")
  return {
    success: true,
    data: {
      preview: {
        id: preview.id,
        category_id: preview.category_id,
        groups,
        matchesCount: preview.matches_count,
        status: preview.status,
        generated_at: preview.generated_at,
        published_at: preview.published_at,
      },
      matchesCount,
    },
  }
}

export async function getCategoryDrawPreview(
  categoryId: string
): Promise<ApiResponse<DrawPreview | null>> {
  const auth = await requireCommittee()
  if (!auth.ok) return auth.response

  const { data, error } = await auth.supabase
    .from("category_draw_previews")
    .select("*")
    .eq("category_id", categoryId)
    .maybeSingle()
  const preview = Array.isArray(data) ? data[0] : data

  if (error) return mapDatabaseFailure(error)
  if (!preview) return { success: true, data: null }

  return {
    success: true,
    data: {
      id: preview.id,
      category_id: preview.category_id,
      groups: preview.groups_payload,
      matchesCount: preview.matches_count,
      status: preview.status,
      generated_at: preview.generated_at,
      published_at: preview.published_at,
    },
  }
}

export async function cancelTournamentDrawPreview(categoryId: string): Promise<
  ApiResponse<{ status: string }>
> {
  const auth = await requireCommittee()
  if (!auth.ok) return auth.response

  const { data, error } = await auth.supabase.rpc(
    "cancel_category_draw_preview",
    { category_uuid: categoryId }
  )

  if (error) return mapDatabaseFailure(error)
  revalidatePath("/admin", "layout")
  return {
    success: true,
    data: { status: data ?? "REGISTRATION_CLOSED" },
  }
}

export async function publishTournamentDraw(categoryId: string): Promise<
  ApiResponse<{ matchesCount: number; status: Category["status"] }>
> {
  const auth = await requireCommittee()
  if (!auth.ok) return auth.response

  const { data, error } = await auth.supabase.rpc("publish_category_draw", {
    category_uuid: categoryId,
  })

  if (error) return mapDatabaseFailure(error)
  revalidatePath("/admin", "layout")
  return {
    success: true,
    data: { matchesCount: Number(data ?? 0), status: "DRAW_PUBLISHED" },
  }
}

export async function completeTournament(
  tournamentId: string
): Promise<ApiResponse<{ status: string }>> {
  const auth = await requireCommittee()
  if (!auth.ok) return auth.response

  const { data, error } = await auth.supabase.rpc("complete_tournament", {
    tournament_uuid: tournamentId,
  })
  if (error) return mapDatabaseFailure(error)
  revalidatePath("/admin", "layout")
  revalidatePath(`/admin/tournaments/${tournamentId}`)
  return { success: true, data: { status: String(data) } }
}

export async function archiveTournament(
  tournamentId: string
): Promise<ApiResponse<{ status: string }>> {
  const auth = await requireCommittee()
  if (!auth.ok) return auth.response

  const { data, error } = await auth.supabase.rpc("archive_tournament", {
    tournament_uuid: tournamentId,
  })
  if (error) return mapDatabaseFailure(error)
  revalidatePath("/admin", "layout")
  return { success: true, data: { status: String(data) } }
}
