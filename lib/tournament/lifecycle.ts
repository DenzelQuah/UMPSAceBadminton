export const TOURNAMENT_STATUSES = [
  "DRAFT",
  "REGISTRATION_OPEN",
  "REGISTRATION_CLOSED",
  "DRAW_PREPARATION",
  "DRAW_GENERATED",
  "DRAW_PUBLISHED",
  "GROUP_STAGE_IN_PROGRESS",
  "GROUP_STAGE_COMPLETED",
  "KNOCKOUT_IN_PROGRESS",
  "COMPLETED",
  "ARCHIVED",
] as const

export type TournamentStatus = (typeof TOURNAMENT_STATUSES)[number]

const CATEGORY_TRANSITIONS: Record<TournamentStatus, readonly TournamentStatus[]> = {
  DRAFT: ["REGISTRATION_OPEN", "ARCHIVED"],
  REGISTRATION_OPEN: ["REGISTRATION_CLOSED", "DRAFT"],
  REGISTRATION_CLOSED: ["DRAW_PREPARATION", "REGISTRATION_OPEN"],
  DRAW_PREPARATION: ["DRAW_GENERATED", "REGISTRATION_CLOSED"],
  DRAW_GENERATED: ["DRAW_PUBLISHED", "DRAW_PREPARATION", "KNOCKOUT_IN_PROGRESS"],
  DRAW_PUBLISHED: ["GROUP_STAGE_IN_PROGRESS"],
  GROUP_STAGE_IN_PROGRESS: ["GROUP_STAGE_COMPLETED"],
  GROUP_STAGE_COMPLETED: ["KNOCKOUT_IN_PROGRESS"],
  KNOCKOUT_IN_PROGRESS: ["COMPLETED"],
  COMPLETED: ["ARCHIVED"],
  ARCHIVED: [],
}

export function isTournamentStatus(value: string): value is TournamentStatus {
  return (TOURNAMENT_STATUSES as readonly string[]).includes(value)
}

export function canTransitionCategory(
  currentStatus: string,
  nextStatus: TournamentStatus
): boolean {
  return (
    isTournamentStatus(currentStatus) &&
    CATEGORY_TRANSITIONS[currentStatus].includes(nextStatus)
  )
}

export function categoryStatusLabel(status: string): string {
  return status
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
}

export function categoryStatusTone(
  status: string
): "neutral" | "info" | "warning" | "success" | "danger" {
  switch (status) {
    case "REGISTRATION_OPEN":
      return "info"
    case "REGISTRATION_CLOSED":
    case "DRAW_PREPARATION":
      return "warning"
    case "DRAW_PUBLISHED":
    case "GROUP_STAGE_COMPLETED":
    case "COMPLETED":
      return "success"
    case "CANCELLED":
    case "ARCHIVED":
      return "danger"
    default:
      return "neutral"
  }
}
