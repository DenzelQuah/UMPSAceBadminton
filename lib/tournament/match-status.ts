/**
 * Match states that remain visible in an official's assigned-court workspace.
 *
 * Terminal states are intentionally included: submitting a result locks the
 * scoring console for the umpire, but it must not make the assignment or its
 * read-only scoring history disappear.
 */
export const ASSIGNED_MATCH_STATUSES = [
  "SCHEDULED",
  "READY",
  "IN_PROGRESS",
  "COMPLETED",
  "WALKOVER",
  "RETIRED",
  "CANCELLED",
  "POSTPONED",
] as const

export type AssignedMatchStatus = (typeof ASSIGNED_MATCH_STATUSES)[number]

export function isAssignedMatchStatus(value: string): value is AssignedMatchStatus {
  return (ASSIGNED_MATCH_STATUSES as readonly string[]).includes(value)
}

/** Unfinished player fixtures. Postponed matches stay visible for rescheduling. */
export const UPCOMING_MATCH_STATUSES = ["SCHEDULED","READY","IN_PROGRESS","POSTPONED"] as const
