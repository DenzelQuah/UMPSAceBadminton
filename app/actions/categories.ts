"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { apiError, type ApiResponse } from "@/lib/apiResponse"
import { requireAuthenticated, requireCommittee } from "@/lib/auth/authorization"
import { categoryEntries } from "@/lib/tournament/entries"
import { databaseReadFailure, isMissingFunction } from "@/lib/supabase/schema"
import type { Category } from "@/app/(dashboard)/tournaments/types"
import { GAME_TYPE_IDS, getGameType } from "@/lib/tournament/category-types"

type CategoryRpcRow = {
  id: string
  tournament_id: string
  name: string
  max_capacity: number
  group_count: number
  qualifiers_per_group: number
  format: Category["format"]
  status: Category["status"]
  created_at: string
  confirmed_count: number
  waitlisted_count: number
}

export type CategoryRegistration = {
  id: string
  player_id: string
  status: string
  seed_number: number | null
  created_at: string
  player: { full_name: string; email: string } | null
}

const categoryInputSchema = z
  .object({
    tournamentId: z.string().uuid(),
    gameType: z.enum(GAME_TYPE_IDS),
    format: z.enum(["STANDARD_3X21", "SINGLE_SET_1X30"]),
    maxCapacity: z.coerce.number().int().min(4).max(1000),
    groupCount: z.coerce.number().int().min(1).max(64).optional().default(1),
    qualifiersPerGroup: z.coerce.number().int().min(1).max(64),
    drawFormat: z.enum(["ROUND_ROBIN","SINGLE_ELIMINATION"]).optional(),
    targetGroupSize: z.coerce.number().int().min(2).max(1000).optional(),
  })
  .refine((data) => data.maxCapacity >= data.groupCount, {
    message: "Maximum competitors must be at least the number of groups.",
    path: ["maxCapacity"],
  })
  .refine(
    (data) =>
      data.qualifiersPerGroup <= Math.floor(data.maxCapacity / data.groupCount),
    {
      message: "Qualifiers cannot exceed the available places in each group.",
      path: ["qualifiersPerGroup"],
    }
  )

function databaseFailure(error: { code?: string; message?: string }): ApiResponse<never> {
  if (isMissingFunction(error)) return databaseReadFailure(error)
  console.error("Category database operation failed", { code: error.code })

  if (
    error.code === "P0001" &&
    /at least (one confirmed player per group|two confirmed entries)/i.test(error.message ?? "")
  ) {
    return apiError(
      "INVALID_STATE_TRANSITION",
      422,
      "Confirm at least two entries before closing registration. Groups will be sized automatically."
    )
  }

  if (error.code === "P0002") {
    return apiError("NOT_FOUND", 404, "The requested category or tournament could not be found.")
  }

  if (["P0001", "23505"].includes(error.code ?? "")) {
    return apiError(
      "INVALID_STATE_TRANSITION",
      422,
      "This category step is no longer available. Refresh and review its current stage."
    )
  }
  if (["22023", "23514", "22P02"].includes(error.code ?? "")) {
    return apiError(
      "VALIDATION_ERROR",
      422,
      "The category settings or roster data are invalid."
    )
  }
  return apiError(
    "DATABASE_ERROR",
    500,
    "The category could not be updated. No partial changes were saved."
  )
}

export async function getCategories(
  tournamentId: string
): Promise<ApiResponse<Category[]>> {
  const auth = await requireAuthenticated()
  if (!auth.ok) return auth.response
  if (!z.string().uuid().safeParse(tournamentId).success) {
    return apiError("BAD_REQUEST", 400, "Invalid tournament identifier.")
  }

  let { data, error } = await auth.supabase.rpc("get_dynamic_tournament_categories", {
    tournament_uuid: tournamentId,
  })
  if (isMissingFunction(error ?? {})) {
    const legacy = await auth.supabase.rpc("get_tournament_entry_categories", { tournament_uuid:tournamentId })
    data=legacy.data; error=legacy.error
  }

  if (error) {
    const { data: fallbackCategories, error: fallbackError } = await auth.supabase
      .from("categories")
      .select("*")
      .eq("tournament_id", tournamentId)
      .order("created_at", { ascending: true })
    if (fallbackError) return databaseFailure(fallbackError)

    const countResults = await Promise.all(
      ((fallbackCategories ?? []) as Array<Category & { id: string }>).map(
        async (category) => {
          const [confirmedResult, waitlistResult] = await Promise.all([
            auth.supabase
              .from("registrations")
              .select("id", { count: "exact", head: true })
              .eq("category_id", category.id)
              .eq("status", "CONFIRMED"),
            auth.supabase
              .from("registrations")
              .select("id", { count: "exact", head: true })
              .eq("category_id", category.id)
              .eq("status", "WAITLISTED"),
          ])
          return { category, confirmedResult, waitlistResult }
        }
      )
    )

    const countFailure = countResults.find(
      ({ confirmedResult, waitlistResult }) =>
        confirmedResult.error ?? waitlistResult.error
    )
    if (countFailure) {
      return databaseFailure(
        countFailure.confirmedResult.error ?? countFailure.waitlistResult.error ?? {}
      )
    }

    const categories = countResults.map(
      ({ category, confirmedResult, waitlistResult }) => ({
        ...category,
        current_registered_count: confirmedResult.count ?? 0,
        current_waitlisted_count: waitlistResult.count ?? 0,
      })
    )
    return { success: true, data: categories }
  }

  return {
    success: true,
    data: ((data ?? []) as CategoryRpcRow[]).map((category) => ({
      ...category,
      current_registered_count: category.confirmed_count,
      current_waitlisted_count: category.waitlisted_count,
    })) as Category[],
  }
}

export async function getCategoryRegistrations(
  categoryId: string
): Promise<ApiResponse<CategoryRegistration[]>> {
  const auth = await requireCommittee()
  if (!auth.ok) return auth.response

  const [{ data: registrations, error: registrationError }, profilesResult] =
    await Promise.all([
      auth.supabase
        .from("registrations")
        .select("id, player_id, status, seed_number, created_at")
        .eq("category_id", categoryId)
        .order("seed_number", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: true }),
      auth.supabase.rpc("admin_list_profiles"),
    ])

  if (registrationError) return databaseFailure(registrationError)

  if (profilesResult.error) return databaseFailure(profilesResult.error)
  const profileRows = profilesResult.data

  const profiles = new Map(
    ((profileRows ?? []) as Array<{
      id: string
      full_name: string
      email: string
    }>).map((profile) => [profile.id, profile])
  )

  const entries = await categoryEntries(auth.supabase, [categoryId])
  if (!entries.success) return entries
  const names = new Map(entries.data.map((entry) => [entry.representative_id, entry.display_name]))

  return {
    success: true,
    data: ((registrations ?? []) as Omit<CategoryRegistration, "player">[]).map(
      (registration) => {
        const profile = profiles.get(registration.player_id)
        return {
          ...registration,
          player: profile
            ? { full_name: names.get(registration.player_id) ?? profile.full_name, email: profile.email }
            : null,
        }
      }
    ),
  }
}

export async function createCategory(
  payload: z.input<typeof categoryInputSchema>
): Promise<ApiResponse<Category>> {
  const auth = await requireCommittee()
  if (!auth.ok) return auth.response

  const parsed = categoryInputSchema.safeParse(payload)
  if (!parsed.success) {
    return apiError(
      "VALIDATION_ERROR",
      400,
      parsed.error.issues[0]?.message ?? "Review the category settings."
    )
  }

  const gameType = getGameType(parsed.data.gameType)
  if (gameType.participationFormat === null) {
    return apiError("VALIDATION_ERROR", 400, "3 v 3 is listed for a future format. Team registration and scoring rules must be defined before creating this category.")
  }
  const params = {
    tournament_uuid: parsed.data.tournamentId,
    category_name: gameType.label,
    category_capacity: parsed.data.maxCapacity,
    category_group_count: parsed.data.groupCount,
    category_qualifier_count: parsed.data.qualifiersPerGroup,
    category_format: parsed.data.format,
  }
  const { data, error } = parsed.data.drawFormat
    ? await auth.supabase.rpc("create_dynamic_category", {
      tournament_uuid:params.tournament_uuid,category_name:params.category_name,category_capacity:params.category_capacity,
      category_qualifier_count:params.category_qualifier_count,category_format:params.category_format,
      entry_format:gameType.participationFormat,draw_format_value:parsed.data.drawFormat,target_group_size_value:parsed.data.targetGroupSize ?? 4,
    })
    : await auth.supabase.rpc(gameType.participationFormat === "DOUBLES" ? "create_doubles_category" : "create_tournament_category", params)
  const category = Array.isArray(data) ? data[0] : data

  if (error || !category) return databaseFailure(error ?? {})
  revalidatePath(`/admin/tournaments/${parsed.data.tournamentId}`)
  revalidatePath(`/tournaments/${parsed.data.tournamentId}`)
  return { success: true, data: category as Category }
}

export async function updateCategoryQualifierCount(
  categoryId: string,
  qualifiersPerGroup: number
): Promise<ApiResponse<{ qualifiersPerGroup: number }>> {
  const auth = await requireCommittee()
  if (!auth.ok) return auth.response

  if (!z.string().uuid().safeParse(categoryId).success) {
    return apiError("BAD_REQUEST", 400, "Invalid category identifier.")
  }
  if (!Number.isInteger(qualifiersPerGroup) || qualifiersPerGroup < 1) {
    return apiError("VALIDATION_ERROR", 400, "Qualifiers must be a positive whole number.")
  }

  const { data, error } = await auth.supabase.rpc("set_category_qualifier_count", {
    category_uuid: categoryId,
    qualifier_count_value: qualifiersPerGroup,
  })
  if (error) return databaseFailure(error)

  const category = Array.isArray(data) ? data[0] : data
  revalidatePath("/admin", "layout")
  return {
    success: true,
    data: { qualifiersPerGroup: Number(category?.qualifiers_per_group ?? qualifiersPerGroup) },
  }
}

export async function updateCategoryStatus(
  categoryId: string,
  status: "REGISTRATION_OPEN" | "REGISTRATION_CLOSED"
): Promise<ApiResponse<{ status: string }>> {
  const auth = await requireCommittee()
  if (!auth.ok) return auth.response

  const { data, error } = await auth.supabase.rpc(
    "set_category_registration_status",
    { category_uuid: categoryId, next_status: status }
  )

  if (error) return databaseFailure(error)
  revalidatePath("/admin", "layout")
  return { success: true, data: { status: String(data) } }
}

export async function updateRegistrationSeed(
  registrationId: string,
  seedNumber: number | null
): Promise<ApiResponse<{ seedNumber: number | null }>> {
  const auth = await requireCommittee()
  if (!auth.ok) return auth.response

  const { data, error } = await auth.supabase.rpc("set_registration_seed", {
    registration_uuid: registrationId,
    seed_value: seedNumber,
  })
  const registration = Array.isArray(data) ? data[0] : data

  if (error || !registration) return databaseFailure(error ?? {})
  return {
    success: true,
    data: { seedNumber: registration.seed_number ?? null },
  }
}

export async function promoteNextWaitlistedPlayer(
  categoryId: string
): Promise<ApiResponse<{ playerName: string }>> {
  const auth = await requireCommittee()
  if (!auth.ok) return auth.response

  const { data, error } = await auth.supabase.rpc("promote_next_waitlisted", {
    category_uuid: categoryId,
  })
  const registration = Array.isArray(data) ? data[0] : data

  if (error || !registration) return databaseFailure(error ?? {})
  return {
    success: true,
    data: { playerName: "The next waitlisted player" },
  }
}
