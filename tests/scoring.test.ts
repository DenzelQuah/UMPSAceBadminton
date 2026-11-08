import { describe, expect, it } from "vitest"

import {
  getBetweenGameIntervalSeconds,
  getCrossingIntervalSeconds,
  getGameState,
  getIntervalSeconds,
  getMatchWinner,
  getNextIncompleteGameNumber,
  hasReachedIntervalThreshold,
  isGameComplete,
  isMatchComplete,
  validateGameScore,
} from "../lib/tournament/scoring"

describe("badminton scoring rules", () => {
  it("requires a two-point lead at 20–20 in standard format", () => {
    expect(isGameComplete("STANDARD_3X21", 21, 20)).toBe(false)
    expect(isGameComplete("STANDARD_3X21", 22, 20)).toBe(true)
  })

  it("ends a standard game immediately at 30–29", () => {
    expect(isGameComplete("STANDARD_3X21", 30, 29)).toBe(true)
    expect(getGameState("STANDARD_3X21", 30, 29)).toBe("COMPLETED")
    expect(validateGameScore("STANDARD_3X21", 1, 30, 29)).toEqual({ valid: true })
    expect(validateGameScore("STANDARD_3X21", 1, 29, 30)).toEqual({ valid: true })
    expect(getGameState("STANDARD_3X21", 30, 30)).toBe("INVALID")
  })

  it("ends a single-set game at 30 and rejects extra points", () => {
    expect(isGameComplete("SINGLE_SET_1X30", 30, 29)).toBe(true)
    expect(getGameState("SINGLE_SET_1X30", 31, 29)).toBe("INVALID")
  })

  it("returns the documented interval duration", () => {
    expect(getIntervalSeconds("STANDARD_3X21", 11, 8)).toBe(60)
    expect(getIntervalSeconds("SINGLE_SET_1X30", 15, 12)).toBe(120)
    expect(getIntervalSeconds("STANDARD_3X21", 12, 8)).toBeNull()
  })

  it("triggers an interval only when a game crosses the threshold", () => {
    expect(
      getCrossingIntervalSeconds(
        "STANDARD_3X21",
        { playerAScore: 10, playerBScore: 8 },
        { playerAScore: 11, playerBScore: 8 }
      )
    ).toBe(60)
    expect(
      getCrossingIntervalSeconds(
        "STANDARD_3X21",
        { playerAScore: 11, playerBScore: 8 },
        { playerAScore: 11, playerBScore: 9 }
      )
    ).toBeNull()
    expect(
      getCrossingIntervalSeconds(
        "SINGLE_SET_1X30",
        { playerAScore: 14, playerBScore: 15 },
        { playerAScore: 14, playerBScore: 16 }
      )
    ).toBeNull()
  })

  it("recognizes games that have already reached their interval threshold", () => {
    expect(hasReachedIntervalThreshold("STANDARD_3X21", 11, 2)).toBe(true)
    expect(hasReachedIntervalThreshold("STANDARD_3X21", 10, 2)).toBe(false)
    expect(hasReachedIntervalThreshold("SINGLE_SET_1X30", 15, 0)).toBe(true)
  })

  it("returns the next game and two-minute rest between standard games", () => {
    expect(getBetweenGameIntervalSeconds("STANDARD_3X21")).toBe(120)
    expect(getBetweenGameIntervalSeconds("SINGLE_SET_1X30")).toBeNull()
    expect(
      getNextIncompleteGameNumber(
        "STANDARD_3X21",
        [{ gameNumber: 1, playerAScore: 21, playerBScore: 15 }],
        1
      )
    ).toBe(2)
    expect(
      getNextIncompleteGameNumber(
        "STANDARD_3X21",
        [
          { gameNumber: 1, playerAScore: 21, playerBScore: 15 },
          { gameNumber: 2, playerAScore: 21, playerBScore: 18 },
        ],
        2
      )
    ).toBe(3)
    expect(
      getNextIncompleteGameNumber(
        "SINGLE_SET_1X30",
        [{ gameNumber: 1, playerAScore: 30, playerBScore: 20 }],
        1
      )
    ).toBeNull()
  })

  it("requires two completed games for a standard match winner", () => {
    const games = [
      { gameNumber: 1, playerAScore: 21, playerBScore: 15 },
      { gameNumber: 2, playerAScore: 18, playerBScore: 21 },
      { gameNumber: 3, playerAScore: 21, playerBScore: 18 },
    ]
    expect(isMatchComplete("STANDARD_3X21", games)).toBe(true)
    expect(getMatchWinner("STANDARD_3X21", games)).toBe("player_a")
  })

  it("returns a validation message for invalid game input", () => {
    expect(validateGameScore("SINGLE_SET_1X30", 2, 1, 0)).toEqual({
      valid: false,
      message: "This format contains one game only.",
    })
    expect(validateGameScore("STANDARD_3X21", 1, -1, 0).valid).toBe(false)
  })
})
