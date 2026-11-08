import { describe, expect, it } from "vitest"

import {
  ASSIGNED_MATCH_STATUSES,
  isAssignedMatchStatus,
} from "../lib/tournament/match-status"

describe("official assigned-match visibility", () => {
  it("keeps active and terminal matches in the official workspace", () => {
    expect(ASSIGNED_MATCH_STATUSES).toEqual([
      "SCHEDULED",
      "READY",
      "IN_PROGRESS",
      "COMPLETED",
      "WALKOVER",
      "RETIRED",
      "CANCELLED",
      "POSTPONED",
    ])
    expect(isAssignedMatchStatus("IN_PROGRESS")).toBe(true)
    expect(isAssignedMatchStatus("COMPLETED")).toBe(true)
    expect(isAssignedMatchStatus("CANCELLED")).toBe(true)
  })

  it("rejects unknown match states", () => {
    expect(isAssignedMatchStatus("UNKNOWN")).toBe(false)
  })
})
