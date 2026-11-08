"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { apiError, apiSuccess, type ApiResponse } from "@/lib/apiResponse"
import { requireAuthenticated, requirePlatformAdmin } from "@/lib/auth/authorization"
import { databaseReadFailure } from "@/lib/supabase/schema"
import type { OrganizationalRole } from "@/lib/auth/organizational-roles"

export type RoleRequest = { id: string; user_id: string; full_name?: string; email?: string; requested_role: Exclude<OrganizationalRole, "PLAYER">; role_detail: string; status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED"; review_note: string; created_at: string }
export type OrganizationMember = { id: string; full_name: string; email: string; organizational_role: OrganizationalRole; organizational_role_detail: string; is_admin: boolean }

function failure(error: { code?: string }): ApiResponse<never> {
  if (["22023", "P0001"].includes(error.code ?? "")) return apiError("VALIDATION_ERROR", 422, "This decision is no longer available, or the request details are invalid. Refresh and try again.")
  return databaseReadFailure(error)
}
export async function getMyRoleRequests(): Promise<ApiResponse<RoleRequest[]>> {
  const auth = await requireAuthenticated()
  if (!auth.ok) return auth.response
  const { data, error } = await auth.supabase.rpc("my_organization_role_requests")
  return error ? failure(error) : apiSuccess((data ?? []) as RoleRequest[])
}
export async function submitRoleRequest(role: Exclude<OrganizationalRole, "PLAYER">, detail: string): Promise<ApiResponse<RoleRequest>> {
  const auth = await requireAuthenticated()
  if (!auth.ok) return auth.response
  const input = z.object({ role: z.enum(["MT", "EXCO", "AJK"]), detail: z.string().trim().min(2).max(100) }).safeParse({ role, detail })
  if (!input.success) return apiError("VALIDATION_ERROR", 400, "Select a role and position or team.")
  const { data, error } = await auth.supabase.rpc("submit_organization_role_request", { role_value: input.data.role, detail_value: input.data.detail })
  if (error) return failure(error)
  revalidatePath("/dashboard")
  return apiSuccess(data as RoleRequest)
}
export async function getOrganizationApprovals(): Promise<ApiResponse<{ requests: RoleRequest[]; members: OrganizationMember[] }>> {
  const auth = await requirePlatformAdmin()
  if (!auth.ok) return auth.response
  const [requests, members] = await Promise.all([auth.supabase.rpc("list_organization_role_requests"), auth.supabase.rpc("list_organization_members")])
  if (requests.error || members.error) return failure(requests.error ?? members.error ?? {})
  return apiSuccess({ requests: requests.data ?? [], members: members.data ?? [] })
}
export async function reviewRoleRequest(id: string, approve: boolean, note: string): Promise<ApiResponse<void>> {
  const auth = await requirePlatformAdmin()
  if (!auth.ok) return auth.response
  const input = z.object({ id: z.string().uuid(), approve: z.boolean(), note: z.string().trim().max(500) }).safeParse({ id, approve, note })
  if (!input.success) return apiError("VALIDATION_ERROR", 400, "Select a valid request and decision.")
  const { error } = await auth.supabase.rpc("review_organization_role_request", { request_uuid: input.data.id, approve: input.data.approve, note_value: input.data.note })
  if (error) return failure(error)
  revalidatePath("/", "layout")
  return apiSuccess(undefined)
}
export async function revokeOrganizationRole(id: string, reason: string): Promise<ApiResponse<void>> {
  const auth = await requirePlatformAdmin()
  if (!auth.ok) return auth.response
  const input = z.object({ id: z.string().uuid(), reason: z.string().trim().min(10).max(500) }).safeParse({ id, reason })
  if (!input.success) return apiError("VALIDATION_ERROR", 400, "Provide a reason of at least ten characters.")
  const { error } = await auth.supabase.rpc("revoke_organization_role", { profile_uuid: input.data.id, reason_value: input.data.reason })
  if (error) return failure(error)
  revalidatePath("/", "layout")
  return apiSuccess(undefined)
}
