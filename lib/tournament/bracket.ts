import { fisherYatesShuffle } from "./draw-engine"

export type BracketSeed = {
  seed: number
  groupName: string
  place: number
  playerId: string
  playerName: string
}

export type BracketPairing = {
  index: number
  label: string
  playerASeed: number | null
  playerBSeed: number | null
  sourcePairingIndexes: number[]
  matchId: string | null
  playerAId: string | null
  playerBId: string | null
  byePlayerId?: string | null
}

export type BracketRound = {
  round: number
  label: string
  pairings: BracketPairing[]
}

export type BracketPairingPayload = {
  index: number
  player_a_id: string | null
  player_b_id: string | null
  source_pairing_indexes: number[]
  match_id: string | null
  bye_player_id?: string | null
}

export type BracketRoundPayload = {
  round: number
  label: string
  pairings: BracketPairingPayload[]
}

export type BracketPayload = {
  qualifier_count: number
  bracket_size?: number
  bye_count?: number
  seeds: Array<{
    seed: number
    group_name: string
    place: number
    player_id: string
    player_name: string
  }>
  rounds: BracketRoundPayload[]
}

export function nextBracketSize(value: number): number {
  if (!Number.isInteger(value) || value < 2 || value > 1024) throw new Error("An elimination bracket needs between 2 and 1024 confirmed entries.")
  return 2 ** Math.ceil(Math.log2(value))
}

export function getBracketRoundLabel(qualifierCount: number, round: number): string {
  qualifierCount = nextBracketSize(qualifierCount)
  const totalRounds = Math.log2(qualifierCount)
  if (round === totalRounds) return "Final"
  if (round === totalRounds - 1) return "Semi-final"
  if (round === totalRounds - 2) return "Quarter-final"
  return `Round of ${qualifierCount / 2 ** (round - 1)}`
}

/**
 * Builds a single-elimination bracket from actual entries, padding to the next
 * power of two. Bye recipients and their positions are drawn randomly.
 *
 * Seeds are supplied in canonical order: all group winners first, then all
 * group runners-up, then the next qualifier position. The first round pairs
 * seed 1 with the last seed, 2 with the second-last, and so on. Later rounds
 * combine adjacent pairings, which keeps the mapping consistent for 4, 8, 16,
 * or larger power-of-two brackets. When byes are required, the remaining real
 * entries retain seed order for their opening pairings.
 */
export function buildSeededBracket(
  seeds: BracketSeed[],
  qualifierCount = seeds.length,
  random: () => number = Math.random
): BracketRound[] {
  const bracketSize = nextBracketSize(qualifierCount)
  if (seeds.length !== qualifierCount) {
    throw new Error("Every knockout seed must have a qualified player.")
  }

  const orderedSeeds = [...seeds].sort((a, b) => a.seed - b.seed)
  if (new Set(seeds.map((s) => s.playerId)).size !== qualifierCount || orderedSeeds.some((s,i) => s.seed !== i+1)) throw new Error("Bracket entries and sequential seed numbers must be unique.")
  const byeCount = bracketSize - qualifierCount
  const byePlayers = fisherYatesShuffle(orderedSeeds,random).slice(0,byeCount)
  const byeIds = new Set(byePlayers.map((p) => p.playerId))
  const playingSeeds = orderedSeeds.filter((s) => !byeIds.has(s.playerId))
  const initialSlots: Array<[BracketSeed,BracketSeed | null]> = []
  for (let index=0;index<playingSeeds.length/2;index++) initialSlots.push([playingSeeds[index],playingSeeds[playingSeeds.length-index-1]])
  initialSlots.push(...byePlayers.map((s):[BracketSeed,null] => [s,null]))
  const slots = byeCount ? fisherYatesShuffle(initialSlots,random) : initialSlots
  const rounds: BracketRound[] = []
  let pairings: BracketPairing[] = []

  for (let index = 0; index < bracketSize / 2; index += 1) {
    const [a,b] = slots[index]
    pairings.push({
      index: index + 1,
      label: `Match ${index + 1}`,
      playerASeed: a.seed,
      playerBSeed: b?.seed ?? null,
      sourcePairingIndexes: [],
      matchId: null,
      playerAId: a.playerId,
      playerBId: b?.playerId ?? null,
      byePlayerId: b ? null : a.playerId,
    })
  }

  for (let round = 1; round <= Math.log2(bracketSize); round += 1) {
    rounds.push({
      round,
      label: getBracketRoundLabel(bracketSize, round),
      pairings,
    })

    if (round === Math.log2(bracketSize)) break

    const nextPairings: BracketPairing[] = []
    for (let index = 0; index < pairings.length / 2; index += 1) {
      const first = pairings[index * 2]
      const second = pairings[index * 2 + 1]
      nextPairings.push({
        index: index + 1,
        label: `R${round + 1}-${index + 1}`,
        playerASeed: null,
        playerBSeed: null,
        sourcePairingIndexes: [first.index, second.index],
        matchId: null,
        playerAId: null,
        playerBId: null,
      })
    }
    pairings = nextPairings
  }

  return rounds
}
