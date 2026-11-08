import { describe, expect, it } from "vitest"

import {
  distributePlayers,
  fisherYatesShuffle,
  generateRoundRobinMatches,
  validateDrawCoverage,
} from "../lib/tournament/draw-engine"
import {
  validateMatchSchedule,
  type ScheduleCandidate,
  type ScheduleEntry,
} from "../lib/tournament/scheduling"
import {
  getGameState,
  getIntervalSeconds,
  getMatchWinner,
  isMatchComplete,
  validateGameScore,
} from "../lib/tournament/scoring"
import { categoryStatusTone } from "../lib/tournament/lifecycle"

const player = (id: string, seed_number?: number) => ({
  id,
  full_name: id,
  ...(seed_number === undefined ? {} : { seed_number }),
})

const candidate: ScheduleCandidate = {
  id: "target",
  playerAId: "a",
  playerBId: "b",
  courtNumber: 1,
  scheduledTime: "2026-09-24T10:00:00.000Z",
  umpireId: "umpire",
  linesmanId: "linesman",
}

const match = (overrides: Partial<ScheduleEntry>): ScheduleEntry => ({
  id: "other",
  playerAId: "x",
  playerBId: "y",
  courtNumber: 2,
  scheduledTime: "2026-09-24T12:00:00.000Z",
  status: "SCHEDULED",
  ...overrides,
})

describe("draw edge cases", () => {
  it("rejects invalid group counts, insufficient players, duplicate players, and invalid seeds", () => {
    expect(() => distributePlayers([player("a")], 0, () => 0)).toThrow("positive integer")
    expect(() => distributePlayers([player("a")], 2, () => 0)).toThrow("at least one")
    expect(() => distributePlayers([player("a"), player("a")], 1, () => 0)).toThrow("more than once")
    expect(() => distributePlayers([player("a", 0), player("b")], 1, () => 0)).toThrow("positive integers")
  })

  it("rejects invalid random sources", () => {
    expect(() => fisherYatesShuffle([1, 2], () => 1)).toThrow("0 (inclusive)")
    expect(() => fisherYatesShuffle([1, 2], () => -0.1)).toThrow("0 (inclusive)")
  })

  it("rejects a duplicate player when total coverage length matches", () => {
    const players = [player("a"), player("b"), player("c"), player("d")]
    const groups = [
      { name: "A", players: [player("a"), player("b")] },
      { name: "B", players: [player("a"), player("c")] },
    ]
    expect(() => validateDrawCoverage(players, groups)).toThrow("more than one group")
  })

  it("rejects duplicate, unregistered, and imbalanced coverage", () => {
    const players = [player("a"), player("b"), player("c"), player("d")]
    const groups = distributePlayers(players, 2, () => 0)
    groups[0].players.push(groups[1].players[0])
    expect(() => validateDrawCoverage(players, groups)).toThrow("exactly once")

    const unregistered = [{ name: "A", players: [player("a"), player("b")] }, { name: "B", players: [player("c"), player("z")] }]
    expect(() => validateDrawCoverage(players, unregistered)).toThrow("not registered")

    const imbalanced = [{ name: "A", players: [player("a")] }, { name: "B", players: [player("b"), player("c"), player("d")] }]
    expect(() => validateDrawCoverage(players, imbalanced)).toThrow("differ by no more")
  })

  it("rejects duplicate group names and group members", () => {
    const groups = [
      { name: "Group A", players: [player("a")] },
      { name: "Group A", players: [player("a")] },
    ]
    expect(() => generateRoundRobinMatches(groups)).toThrow("unique")
    expect(() => generateRoundRobinMatches([{ name: "Group A", players: [player("a"), player("a")] }])).toThrow("more than once")
  })
})

describe("scheduling edge cases", () => {
  it("rejects invalid times and duplicate officials", () => {
    expect(validateMatchSchedule({ ...candidate, scheduledTime: "not-a-date" }, [])).toEqual([
      { type: "INVALID_TIME", message: "Choose a valid match start time." },
    ])
    const conflicts = validateMatchSchedule({ ...candidate, umpireId: "same", linesmanId: "same" }, [])
    expect(conflicts.some((item) => item.type === "DUPLICATE_OFFICIAL")).toBe(true)
  })

  it("rejects self-officiating when the official is Player B", () => {
    const conflicts = validateMatchSchedule({ ...candidate, umpireId: "b" }, [])
    expect(conflicts.some((item) => item.type === "SELF_OFFICIATING")).toBe(true)
  })

  it("allows a valid rest gap and ignores cancelled matches", () => {
    const valid = validateMatchSchedule(
      { ...candidate, scheduledTime: "2026-09-24T11:00:00.000Z" },
      [match({ playerAId: "a", scheduledTime: "2026-09-24T10:00:00.000Z" })]
    )
    expect(valid.some((item) => item.type === "INSUFFICIENT_REST")).toBe(false)

    const cancelled = validateMatchSchedule(candidate, [
      match({ courtNumber: 1, scheduledTime: "2026-09-24T10:10:00.000Z", status: "CANCELLED" }),
    ])
    expect(cancelled.some((item) => item.type === "COURT_COLLISION")).toBe(false)
  })
})

describe("scoring edge cases", () => {
  it("recognizes all safe game states", () => {
    expect(getGameState("STANDARD_3X21", 0, 0)).toBe("NOT_STARTED")
    expect(getGameState("STANDARD_3X21", 5, 3)).toBe("IN_PROGRESS")
    expect(getGameState("STANDARD_3X21", 21, 19)).toBe("COMPLETED")
    expect(getGameState("STANDARD_3X21", 21, 20)).toBe("IN_PROGRESS")
    expect(validateGameScore("STANDARD_3X21", 1, 5, 3)).toEqual({ valid: true })
  })

  it("rejects invalid game numbers and returns no winner for incomplete matches", () => {
    expect(validateGameScore("STANDARD_3X21", 0, 0, 0).valid).toBe(false)
    expect(validateGameScore("STANDARD_3X21", 4, 0, 0).valid).toBe(false)
    expect(isMatchComplete("STANDARD_3X21", [{ gameNumber: 1, playerAScore: 21, playerBScore: 19 }])).toBe(false)
    expect(getMatchWinner("STANDARD_3X21", [{ gameNumber: 1, playerAScore: 21, playerBScore: 19 }])).toBeNull()
  })

  it("handles single-set winners and interval boundaries", () => {
    expect(isMatchComplete("SINGLE_SET_1X30", [{ gameNumber: 1, playerAScore: 30, playerBScore: 28 }])).toBe(true)
    expect(getMatchWinner("SINGLE_SET_1X30", [{ gameNumber: 1, playerAScore: 28, playerBScore: 30 }])).toBe("player_b")
    expect(getIntervalSeconds("STANDARD_3X21", 11, 10)).toBe(60)
    expect(getIntervalSeconds("SINGLE_SET_1X30", 15, 15)).toBe(120)
  })
})

describe("status presentation", () => {
  it("uses semantic tones for lifecycle states", () => {
    expect(categoryStatusTone("REGISTRATION_OPEN")).toBe("info")
    expect(categoryStatusTone("DRAW_PREPARATION")).toBe("warning")
    expect(categoryStatusTone("DRAW_PUBLISHED")).toBe("success")
    expect(categoryStatusTone("ARCHIVED")).toBe("danger")
    expect(categoryStatusTone("DRAFT")).toBe("neutral")
  })
})
