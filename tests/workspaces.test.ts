import { describe, expect, it } from "vitest"
import { availableWorkspaces } from "../lib/auth/workspaces"

describe("one account workspace access", () => {
  it("shows only the player workspace for a regular player", () => {
    expect(availableWorkspaces({ isOrganizer: false, isPlayer: true, isOfficial: false }).map((w) => w.id)).toEqual(["player"])
  })
  it("includes officials without requiring an umpire assignment", () => {
    expect(availableWorkspaces({ isOrganizer: false, isPlayer: true, isOfficial: true }).map((w) => w.id)).toEqual(["player", "official"])
  })
  it("lets an approved administrator reach all three workspaces", () => {
    expect(availableWorkspaces({ isOrganizer: true, isPlayer: true, isOfficial: true }).map((w) => w.id)).toEqual(["administration", "player", "official"])
  })
})
