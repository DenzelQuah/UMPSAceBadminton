"use server"

import type { User } from "@supabase/supabase-js"
import { cache } from "react"

import { createClient } from "@/lib/supabase/server"
import type { Profile } from "@/app/(dashboard)/tournaments/types"
import { ASSIGNED_MATCH_STATUSES } from "@/lib/tournament/match-status"
import { readActorProfile } from "@/lib/auth/actor-profile"
import { canManageTournaments, isApprovedStaff } from "@/lib/auth/organizational-roles"

export type UserRoleProfile = {
  user: User
  profile: Pick<
    Profile,
    | "id"
    | "full_name"
    | "email"
    | "matric_number"
    | "is_admin"
    | "is_community_member"
  > & { organizational_role: "PLAYER" | "MT" | "EXCO" | "AJK"; organizational_role_detail: string; user_role?: string; tournament_ajk_ids?: string[] } | null
  roles: {
    isOrganizer: boolean
    isPlatformAdmin: boolean
    isCommunityMember: boolean
    isUmpire: boolean
    isLinesman: boolean
    isOfficial: boolean
    isPlayer: boolean
  }
}

const loadCurrentUserWithRoles = cache(async (): Promise<UserRoleProfile | null> => {
  const supabase = await createClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) return null

  const { data: profile, error: profileError } = await readActorProfile(supabase)

  if (profileError || !profile) {
    return {
      user,
      profile: null,
      roles: {
        isOrganizer: false,
        isPlatformAdmin: false,
        isCommunityMember: false,
        isUmpire: false,
        isLinesman: false,
        isOfficial: false,
        isPlayer: false,
      },
    }
  }

  const [{ count: assignedMatchCount }, { count: linesmanMatchCount }] =
    await Promise.all([
      supabase
        .from("matches")
        .select("id", { count: "exact", head: true })
        .eq("umpire_id", user.id)
        // Do not drop the umpire workspace after a result is submitted. The
        // assignment remains part of the official's match history.
        .in("status", [...ASSIGNED_MATCH_STATUSES]),
      supabase
        .from("matches")
        .select("id", { count: "exact", head: true })
        .eq("linesman_id", user.id)
        .in("status", [...ASSIGNED_MATCH_STATUSES]),
    ])

  const isCommunityMember = profile.is_community_member === true
  const isOrganizer = canManageTournaments(profile)
  const canOfficiate = !profile.role_model_available || isOrganizer || isApprovedStaff(profile)
  const isUmpire = profile.tournament_roles_available ? profile.authorized_umpire_match_ids.length > 0 : canOfficiate && (assignedMatchCount ?? 0) > 0
  const isLinesman = profile.tournament_roles_available ? profile.authorized_linesman_match_ids.length > 0 : canOfficiate && (linesmanMatchCount ?? 0) > 0
  const isPlayer = true

  return {
    user,
    profile: {
      id: profile.id,
      full_name: profile.full_name,
      email: profile.email,
      matric_number: profile.matric_number,
      is_admin: profile.is_admin,
      is_community_member: profile.is_community_member,
      organizational_role: profile.organizational_role,
      organizational_role_detail: profile.organizational_role_detail,
      user_role: profile.user_role,
      tournament_ajk_ids: profile.tournament_ajk_ids,
    },
    roles: {
      isOrganizer,
      isPlatformAdmin: profile.is_admin === true,
      isCommunityMember,
      isUmpire,
      isLinesman,
      isOfficial: isOrganizer || isApprovedStaff(profile) || (!profile.role_model_available && isCommunityMember) || isUmpire || isLinesman,
      isPlayer,
    },
  }
})

export async function getCurrentUserWithRoles(): Promise<UserRoleProfile | null> {
  return loadCurrentUserWithRoles()
}
