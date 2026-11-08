import "server-only"
import type { createClient } from "@/lib/supabase/server"
import { approvedRole,isPlatformAdministrator,normalizeApprovedRole,type OrganizationalRole } from "./organizational-roles"

export type ActorProfile = {
  id: string; full_name: string; email: string; matric_number: string | null;
  is_admin: boolean; is_community_member: boolean;
  organizational_role: OrganizationalRole; organizational_role_detail: string;
  role_model_available: boolean;
  tournament_roles_available: boolean;
  user_role: OrganizationalRole | "SYSTEM_ADMIN";
  tournament_ajk_ids: string[];
  authorized_umpire_match_ids: string[];
  authorized_linesman_match_ids: string[];
}

export async function readActorProfile(client: Awaited<ReturnType<typeof createClient>>) {
  let result = await client.rpc("current_user_access")
  const tournamentRoles = result.error?.code !== "PGRST202"
  if (!tournamentRoles) result = await client.rpc("current_actor_profile")
  const legacy = result.error?.code === "PGRST202"
  if (legacy) result = await client.rpc("current_user_profile")
  const row = Array.isArray(result.data) ? result.data[0] : result.data
  return { error: result.error, data: row ? {
    ...row, organizational_role: normalizeApprovedRole(row.organizational_role)==="SYSTEM_ADMIN" ? "PLAYER" : normalizeApprovedRole(row.organizational_role) ?? "PLAYER",
    is_admin: isPlatformAdministrator(row),
    organizational_role_detail: row.organizational_role_detail ?? "",
    role_model_available: !legacy,
    tournament_roles_available: tournamentRoles,
    user_role: approvedRole(row),
    tournament_ajk_ids: row.tournament_ajk_ids ?? [],
    authorized_umpire_match_ids: row.authorized_umpire_match_ids ?? [],
    authorized_linesman_match_ids: row.authorized_linesman_match_ids ?? [],
  } as ActorProfile : null }
}
