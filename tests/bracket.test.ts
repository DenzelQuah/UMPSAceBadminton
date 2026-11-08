import { describe, expect, it } from "vitest"
import { orderQualifiers } from "../lib/tournament/qualification"

import {
  buildSeededBracket,
  getBracketRoundLabel,
  type BracketSeed,
} from "../lib/tournament/bracket"

function seeds(count: number): BracketSeed[] {
  return Array.from({ length: count }, (_, index) => ({
    seed: index + 1,
    groupName: `Group ${String.fromCharCode(65 + (index % 4))}`,
    place: Math.floor(index / 4) + 1,
    playerId: `player-${index + 1}`,
    playerName: `Player ${index + 1}`,
  }))
}

describe("seeded knockout bracket", () => {
  it("normalizes group-by-group qualifiers to winners then runners-up", () => {
    const qualifiers = ["A", "B", "C", "D"].flatMap((group) => [1, 2].map((place) => ({ seed: 0, groupName: `Group ${group}`, place, playerId: `${group}${place}`, playerName: `${group}${place}` })))
    expect(buildSeededBracket(orderQualifiers(qualifiers))[0].pairings.map((p) => [p.playerAId, p.playerBId])).toEqual([["A1", "D2"], ["B1", "C2"], ["C1", "B2"], ["D1", "A2"]])
  })
  it("builds the proposed four-group eight-player mapping", () => {
    const rounds = buildSeededBracket(seeds(8))

    expect(rounds.map((round) => round.label)).toEqual([
      "Quarter-final",
      "Semi-final",
      "Final",
    ])
    expect(rounds[0].pairings.map((pairing) => [pairing.playerASeed, pairing.playerBSeed])).toEqual([
      [1, 8],
      [2, 7],
      [3, 6],
      [4, 5],
    ])
    expect(rounds[1].pairings[0].sourcePairingIndexes).toEqual([1, 2])
    expect(rounds[2].pairings[0].sourcePairingIndexes).toEqual([1, 2])
  })

  it("uses the same seeded mapping for a sixteen-player bracket", () => {
    const rounds = buildSeededBracket(seeds(16))

    expect(rounds.map((round) => round.label)).toEqual([
      "Round of 16",
      "Quarter-final",
      "Semi-final",
      "Final",
    ])
    expect(rounds[0].pairings[0].playerBSeed).toBe(16)
    expect(rounds[0].pairings[7].playerASeed).toBe(8)
    expect(rounds[0].pairings[7].playerBSeed).toBe(9)
  })

  it("labels smaller power-of-two brackets correctly", () => {
    expect(getBracketRoundLabel(4, 1)).toBe("Semi-final")
    expect(getBracketRoundLabel(4, 2)).toBe("Final")
    expect(getBracketRoundLabel(2, 1)).toBe("Final")
    expect(getBracketRoundLabel(32, 2)).toBe("Round of 16")
  })

  it("pads six actual entries to eight places with two randomly assigned byes", () => {
    const rounds = buildSeededBracket(seeds(6),6,() => 0.42)
    expect(rounds[0].pairings).toHaveLength(4)
    expect(rounds[0].pairings.filter((p) => p.byePlayerId)).toHaveLength(2)
    expect(rounds.map((r) => r.pairings.length)).toEqual([4,2,1])
  })
})
