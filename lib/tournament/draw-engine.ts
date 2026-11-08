export interface Player {
  id: string
  full_name: string
  seed_number?: number | null
}

export interface Group {
  name: string
  players: Player[]
}

export interface Match {
  player_a_id: string
  player_b_id: string
  group_name: string
  round?: number
}

export function dynamicGroupCount(entryCount: number, targetGroupSize = 4, qualifiersPerGroup = 1): number {
  if (!Number.isInteger(entryCount) || entryCount < 2) throw new Error("At least two confirmed entries are required for a draw.")
  if (!Number.isInteger(targetGroupSize) || targetGroupSize < 2) throw new Error("Target group size must be at least two.")
  if (!Number.isInteger(qualifiersPerGroup) || qualifiersPerGroup < 1) throw new Error("Qualifiers per group must be positive.")
  return Math.max(1,Math.min(64,Math.ceil(entryCount / targetGroupSize),Math.floor(entryCount / Math.max(2,qualifiersPerGroup))))
}

export type RoundRobinRound = { round:number; matches:Match[]; restingPlayerIds:string[] }

/** Circle rotation: each real pair plays once; an odd field rests one entry per round. */
export function generateRoundRobinRounds(group:Group):RoundRobinRound[] {
  if (new Set(group.players.map((p) => p.id)).size !== group.players.length) throw new Error("A player cannot appear more than once in a group.")
  if (group.players.length < 2) return []
  const slots:Array<Player | null> = [...group.players]
  if (slots.length % 2) slots.push(null)
  const rounds:RoundRobinRound[] = []
  for (let round=1;round<slots.length;round++) {
    const matches:Match[] = [],restingPlayerIds:string[] = []
    for (let i=0;i<slots.length/2;i++) {
      const a=slots[i],b=slots[slots.length-i-1]
      if (a && b) matches.push({ player_a_id:a.id,player_b_id:b.id,group_name:group.name,round })
      else if (a || b) restingPlayerIds.push((a ?? b)!.id)
    }
    rounds.push({ round,matches,restingPlayerIds })
    slots.splice(1,0,slots.pop()!)
  }
  return rounds
}

function assertRandomValue(value: number): void {
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new Error("The random source must return a value from 0 (inclusive) to 1 (exclusive).")
  }
}

export function fisherYatesShuffle<T>(
  items: T[],
  random: () => number = Math.random
): T[] {
  const shuffled = [...items]
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const randomValue = random()
    assertRandomValue(randomValue)
    const swapIndex = Math.floor(randomValue * (index + 1))
    ;[shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]]
  }
  return shuffled
}

function groupLabel(index: number): string {
  let label = ""
  let current = index

  do {
    label = String.fromCharCode(65 + (current % 26)) + label
    current = Math.floor(current / 26) - 1
  } while (current >= 0)

  return label
}

export function distributePlayers(
  players: Player[],
  groupCount: number,
  random: () => number = Math.random
): Group[] {
  if (!Number.isInteger(groupCount) || groupCount < 1) {
    throw new Error("Group count must be a positive integer.")
  }
  if (players.length < groupCount) {
    throw new Error("There must be at least one registered player per group.")
  }
  if (new Set(players.map((player) => player.id)).size !== players.length) {
    throw new Error("A player cannot appear more than once in a draw.")
  }

  const seededPlayers = players
    .filter(
      (player): player is Player & { seed_number: number } =>
        player.seed_number !== undefined && player.seed_number !== null
    )
    .sort((first, second) => first.seed_number - second.seed_number)
  const seedNumbers = seededPlayers.map((player) => player.seed_number)

  if (seedNumbers.some((seed) => !Number.isInteger(seed) || seed < 1)) {
    throw new Error("Seed numbers must be positive integers.")
  }
  if (new Set(seedNumbers).size !== seedNumbers.length) {
    throw new Error("Seed numbers must be unique within a category.")
  }

  const groups: Group[] = Array.from({ length: groupCount }, (_, index) => ({
    name: `Group ${groupLabel(index)}`,
    players: [],
  }))

  // Put the first wave of seeds into separate groups before any second seed.
  seededPlayers.forEach((player, index) => {
    groups[index % groupCount].players.push(player)
  })

  const unseededPlayers = players.filter(
    (player) => player.seed_number === undefined || player.seed_number === null
  )
  const shuffledUnseededPlayers = fisherYatesShuffle(unseededPlayers, random)

  // Always feed the smallest group. This keeps group sizes within one player.
  shuffledUnseededPlayers.forEach((player) => {
    const smallestGroupSize = Math.min(
      ...groups.map((group) => group.players.length)
    )
    const targetGroup = groups.find(
      (group) => group.players.length === smallestGroupSize
    )
    if (!targetGroup) {
      throw new Error("The draw could not assign a player to a group.")
    }
    targetGroup.players.push(player)
  })

  return groups
}

export function validateDrawCoverage(players: Player[], groups: Group[]): void {
  const expectedPlayerIds = new Set(players.map((player) => player.id))
  const assignedPlayerIds = groups.flatMap((group) =>
    group.players.map((player) => player.id)
  )

  if (assignedPlayerIds.length !== expectedPlayerIds.size) {
    throw new Error("Every registered player must appear exactly once in the draw.")
  }
  if (new Set(assignedPlayerIds).size !== assignedPlayerIds.length) {
    throw new Error("A player cannot appear in more than one group.")
  }
  if (assignedPlayerIds.some((playerId) => !expectedPlayerIds.has(playerId))) {
    throw new Error("The draw contains a player who is not registered.")
  }

  if (groups.length > 1) {
    const sizes = groups.map((group) => group.players.length)
    if (Math.max(...sizes) - Math.min(...sizes) > 1) {
      throw new Error("Group sizes must differ by no more than one player.")
    }
  }
}

export function generateRoundRobinMatches(groups: Group[]): Match[] {
  const matches: Match[] = []
  const groupNames = new Set<string>()

  for (const group of groups) {
    if (groupNames.has(group.name)) {
      throw new Error("Group names must be unique.")
    }
    groupNames.add(group.name)

    if (new Set(group.players.map((player) => player.id)).size !== group.players.length) {
      throw new Error("A player cannot appear more than once in a group.")
    }

    matches.push(...generateRoundRobinRounds(group).flatMap((round) => round.matches))
  }

  return matches
}
