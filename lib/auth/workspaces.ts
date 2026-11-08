export type WorkspaceAccess = {
  isOrganizer: boolean
  isPlayer: boolean
  isOfficial: boolean
}

export function availableWorkspaces(access: WorkspaceAccess) {
  return [
    ...(access.isOrganizer ? [{ id: "administration", name: "MT Dashboard", href: "/mt", description: "Review tournament AJK applications and manage your tournaments." }] : []),
    ...(access.isPlayer ? [{ id: "player", name: "Player", href: "/tournaments", description: "Enter singles or doubles categories, manage your partner and follow your matches." }] : []),
    ...(access.isOfficial ? [{ id: "official", name: "Committee duties", href: "/umpire", description: "EXCO and AJK members view match duties assigned by MT. Scoring is available only for assigned umpires." }] : []),
  ]
}
