import { describe, expect, it } from "vitest"

import {
  validateMatchSchedule,
  type ScheduleCandidate,
  type ScheduleEntry,
} from "../lib/tournament/scheduling"

const baseCandidate: ScheduleCandidate = {
  id: "target",
  playerAId: "player-a",
  playerBId: "player-b",
  courtNumber: 1,
  scheduledTime: "2026-09-24T10:00:00.000Z",
  umpireId: "umpire-1",
  linesmanId: "linesman-1",
}

function match(overrides: Partial<ScheduleEntry>): ScheduleEntry {
  return {
    id: "existing",
    playerAId: "player-x",
    playerBId: "player-y",
    courtNumber: 2,
    scheduledTime: "2026-09-24T12:00:00.000Z",
    umpireId: null,
    linesmanId: null,
    status: "SCHEDULED",
    ...overrides,
  }
}

describe("match scheduling rules", () => {
  it("rejects a simultaneous court collision", () => {
    const conflicts = validateMatchSchedule(baseCandidate, [
      match({
        courtNumber: 1,
        scheduledTime: "2026-09-24T10:20:00.000Z",
      }),
    ])

    expect(conflicts.some((conflict) => conflict.type === "COURT_COLLISION")).toBe(true)
  })

  it("rejects a player playing two matches at once", () => {
    const conflicts = validateMatchSchedule(baseCandidate, [
      match({
        playerAId: "player-a",
        scheduledTime: "2026-09-24T10:10:00.000Z",
      }),
    ])

    expect(
      conflicts.some((conflict) => conflict.type === "PLAYER_DOUBLE_BOOKING")
    ).toBe(true)
  })

  it("requires twenty minutes of rest between player matches", () => {
    const conflicts = validateMatchSchedule(
      {
        ...baseCandidate,
        scheduledTime: "2026-09-24T10:50:00.000Z",
      },
      [match({ playerAId: "player-a", scheduledTime: "2026-09-24T10:00:00.000Z" })]
    )

    expect(conflicts.some((conflict) => conflict.type === "INSUFFICIENT_REST")).toBe(true)
  })

  it("rejects simultaneous officiating assignments", () => {
    const conflicts = validateMatchSchedule(baseCandidate, [
      match({
        umpireId: "umpire-1",
        scheduledTime: "2026-09-24T10:20:00.000Z",
      }),
    ])

    expect(
      conflicts.some((conflict) => conflict.type === "OFFICIAL_DOUBLE_BOOKING")
    ).toBe(true)
  })

  it("enforces the player-official start-time buffer", () => {
    const conflicts = validateMatchSchedule(
      {
        ...baseCandidate,
        scheduledTime: "2026-09-24T11:00:00.000Z",
        umpireId: "umpire-1",
        linesmanId: null,
      },
      [
        match({
          playerAId: "umpire-1",
          scheduledTime: "2026-09-24T10:00:00.000Z",
        }),
      ]
    )

    expect(
      conflicts.some((conflict) => conflict.type === "PLAYER_OFFICIAL_BUFFER")
    ).toBe(true)
  })

  it("rejects self-officiating before persistence", () => {
    const conflicts = validateMatchSchedule(
      { ...baseCandidate, umpireId: "player-a" },
      []
    )

    expect(conflicts.some((conflict) => conflict.type === "SELF_OFFICIATING")).toBe(true)
  })
})
