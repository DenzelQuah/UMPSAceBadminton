import { describe, expect, it } from "vitest"

import {
  distributePlayers,
  fisherYatesShuffle,
  generateRoundRobinMatches,
  validateDrawCoverage,
  type Player,
} from "../lib/tournament/draw-engine"

function players(count: number, seedCount = 0): Player[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `player-${index + 1}`,
    full_name: `Player ${index + 1}`,
    ...(index < seedCount ? { seed_number: index + 1 } : {}),
  }))
}

describe("draw engine", () => {
  it("places eight seeds into eight different groups in seed order", () => {
    const groups = distributePlayers(players(32, 8), 8, () => 0.42)

    expect(groups.map((group) => group.players[0]?.seed_number)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8,
    ])
    expect(new Set(groups.map((group) => group.players[0]?.id)).size).toBe(8)
  })

  it("does not leave a group seedless while another group has multiple seeds", () => {
    const groups = distributePlayers(players(24, 5), 8, () => 0.42)

    for (const group of groups) {
      expect(group.players.filter((player) => player.seed_number).length).toBeLessThanOrEqual(1)
    }
  })

  it("keeps thirty-four players in balanced groups across eight groups", () => {
    const groups = distributePlayers(players(34), 8, () => 0.42)
    const sizes = groups.map((group) => group.players.length).sort((a, b) => a - b)

    expect(sizes).toEqual([4, 4, 4, 4, 4, 4, 5, 5])
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1)
  })

  it("rejects duplicate seed numbers", () => {
    const drawPlayers = players(8)
    drawPlayers[0].seed_number = 1
    drawPlayers[1].seed_number = 1

    expect(() => distributePlayers(drawPlayers, 4, () => 0.42)).toThrow(
      "Seed numbers must be unique"
    )
  })

  it("generates every pair exactly once in a four-player round robin", () => {
    const groups = distributePlayers(players(4), 1, () => 0.42)
    const matches = generateRoundRobinMatches(groups)
    const pairKeys = matches.map((match) =>
      [match.player_a_id, match.player_b_id].sort().join(":")
    )

    expect(matches).toHaveLength(6)
    expect(new Set(pairKeys).size).toBe(6)
  })

  it("uses unique spreadsheet-style labels for large group counts", () => {
    const groups = distributePlayers(players(64), 64, () => 0.42)

    expect(groups[0].name).toBe("Group A")
    expect(groups[25].name).toBe("Group Z")
    expect(groups[26].name).toBe("Group AA")
    expect(groups[63].name).toBe("Group BL")
    expect(new Set(groups.map((group) => group.name)).size).toBe(64)
  })

  it("does not mutate the source array while shuffling", () => {
    const source = [1, 2, 3, 4]
    const shuffled = fisherYatesShuffle(source, () => 0)

    expect(source).toEqual([1, 2, 3, 4])
    expect(shuffled).toEqual([2, 3, 4, 1])
  })

  it("validates complete, unique group coverage", () => {
    const drawPlayers = players(8)
    const groups = distributePlayers(drawPlayers, 2, () => 0.42)

    expect(() => validateDrawCoverage(drawPlayers, groups)).not.toThrow()
    groups[0].players.push(drawPlayers[0])
    expect(() => validateDrawCoverage(drawPlayers, groups)).toThrow(
      "Every registered player must appear exactly once"
    )
  })
})
