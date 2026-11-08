export const ORGANIZATIONAL_ROLES = ["PLAYER", "MT", "EXCO", "AJK"] as const
export type OrganizationalRole = (typeof ORGANIZATIONAL_ROLES)[number]
export const ROLE_DETAILS = {
  PLAYER: [],
  MT: ["President", "Vice President", "Secretary", "Assistant Secretary", "Treasurer", "Other Majlis Tertinggi"],
  EXCO: ["Technical", "Logistics", "Multimedia", "Public Relations", "Other EXCO team"],
  AJK: ["Part-time committee member"],
} as const
export const ROLE_LABELS: Record<OrganizationalRole, string> = {
  PLAYER: "Player", MT: "MT · Majlis Tertinggi", EXCO: "EXCO", AJK: "AJK · Part-time committee",
}
export type ApprovedRole = OrganizationalRole | "SYSTEM_ADMIN"
export type ApprovedRoleSource = {is_admin?:boolean;organizational_role?:string;user_role?:string;role?:string}

export function normalizeApprovedRole(value:unknown):ApprovedRole | null {
  if(typeof value!=="string")return null
  const role=value.trim().toUpperCase()
  if(["ADMIN","ADMINISTRATOR","SYSTEM_ADMIN","PLATFORM_ADMIN"].includes(role))return "SYSTEM_ADMIN"
  return (ORGANIZATIONAL_ROLES as readonly string[]).includes(role) ? role as OrganizationalRole : null
}

/** Accept only approved database profile fields here, never signup metadata. */
export function approvedRole(profile:ApprovedRoleSource | null | undefined):ApprovedRole {
  if(profile?.is_admin===true)return "SYSTEM_ADMIN"
  const values=[profile?.organizational_role,profile?.user_role,profile?.role].map(normalizeApprovedRole)
  return (["SYSTEM_ADMIN","MT","EXCO","AJK","PLAYER"] as const).find((role)=>values.includes(role)) ?? "PLAYER"
}
export function isPlatformAdministrator(profile:ApprovedRoleSource | null | undefined) {
  return approvedRole(profile)==="SYSTEM_ADMIN"
}
export function canManageTournaments(profile:ApprovedRoleSource | null | undefined) {
  return ["SYSTEM_ADMIN","MT"].includes(approvedRole(profile))
}
export function canAssignMatchOfficials(profile:ApprovedRoleSource | null | undefined) {
  return ["SYSTEM_ADMIN","MT","EXCO"].includes(approvedRole(profile))
}
export function canApplyForCommitteeRoles(profile:ApprovedRoleSource | null | undefined) {
  if(!profile)return false
  return !["SYSTEM_ADMIN","MT","EXCO"].includes(approvedRole(profile))
}
export function isApprovedStaff(profile: (ApprovedRoleSource & {tournament_ajk_ids?:string[]}) | null | undefined) {
  return ["EXCO","AJK"].includes(approvedRole(profile)) || (profile?.tournament_ajk_ids?.length ?? 0) > 0
}

export function displayName(name: string, role?: string) {
  return role === "AJK" ? `(AJK) ${name}` : name
}
