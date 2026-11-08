import "server-only"
import { apiError, apiSuccess, type ApiFailure, type ApiResponse } from "@/lib/apiResponse"
import type { createClient } from "@/lib/supabase/server"
import type { Registration } from "@/app/(dashboard)/tournaments/types"

type Client = Awaited<ReturnType<typeof createClient>>
export function isMissingFunction(error: { code?: string }) { return error.code === "PGRST202" }
export function databaseReadFailure(error: { code?: string }): ApiFailure {
  if (isMissingFunction(error) || ["42703", "PGRST204", "PGRST205", "42P01"].includes(error.code ?? "")) {
    return apiError("DATABASE_SETUP_REQUIRED", 503, "This feature needs the latest database update. An administrator must finish the database setup before it can be used.")
  }
  if (error.code === "42501") return apiError("AUTH_FORBIDDEN", 403, "Your account cannot access these tournament records.")
  return apiError("DATABASE_ERROR", 500, "Tournament data could not be loaded. Please try again.")
}

/** Only permit legacy reads when the database demonstrably has no doubles column.
 * A permission error or a partially installed doubles schema must never downgrade
 * a pair to a single athlete or omit the partner from authorization decisions.
 */
export async function isLegacySinglesSchema(client: Client): Promise<ApiResponse<boolean>> {
  const { error } = await client.from("registrations").select("partner_id").limit(0)
  if (error?.code === "42703") return apiSuccess(true)
  if (error) return databaseReadFailure(error)
  return apiSuccess(false)
}

export async function playerRegistrations(client: Client, userId: string): Promise<ApiResponse<Registration[]>> {
  const result = await client.rpc("get_my_registrations")
  if (!result.error) return apiSuccess((result.data ?? []) as Registration[])
  if (!isMissingFunction(result.error)) return databaseReadFailure(result.error)
  const legacy = await isLegacySinglesSchema(client)
  if (!legacy.success) return legacy
  if (!legacy.data) return databaseReadFailure(result.error)
  const fallback = await client.from("registrations").select("*").eq("player_id", userId).order("created_at", { ascending: false })
  if (fallback.error) return databaseReadFailure(fallback.error)
  return apiSuccess((fallback.data ?? []) as Registration[])
}
