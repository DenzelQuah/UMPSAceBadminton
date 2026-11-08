import { describe, expect, it } from "vitest"

import {
  canTransitionCategory,
  categoryStatusLabel,
  isTournamentStatus,
} from "../lib/tournament/lifecycle"

describe("category lifecycle", () => {
  it("supports the documented draw preparation sequence", () => {
    expect(canTransitionCategory("DRAFT", "REGISTRATION_OPEN")).toBe(true)
    expect(canTransitionCategory("REGISTRATION_OPEN", "REGISTRATION_CLOSED")).toBe(true)
    expect(canTransitionCategory("REGISTRATION_CLOSED", "DRAW_PREPARATION")).toBe(true)
    expect(canTransitionCategory("DRAW_PREPARATION", "DRAW_GENERATED")).toBe(true)
    expect(canTransitionCategory("DRAW_GENERATED", "DRAW_PUBLISHED")).toBe(true)
    expect(canTransitionCategory("DRAW_GENERATED", "KNOCKOUT_IN_PROGRESS")).toBe(true)
  })

  it("prevents skipped and reversed transitions", () => {
    expect(canTransitionCategory("DRAFT", "DRAW_PUBLISHED")).toBe(false)
    expect(canTransitionCategory("DRAW_PUBLISHED", "REGISTRATION_OPEN")).toBe(false)
    expect(canTransitionCategory("ARCHIVED", "COMPLETED")).toBe(false)
  })

  it("validates and formats database status values", () => {
    expect(isTournamentStatus("DRAW_GENERATED")).toBe(true)
    expect(isTournamentStatus("UNKNOWN")).toBe(false)
    expect(categoryStatusLabel("REGISTRATION_OPEN")).toBe("Registration Open")
  })
})
