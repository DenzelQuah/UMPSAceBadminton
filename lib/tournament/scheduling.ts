export type ScheduleConflictType =
  | "INVALID_TIME"
  | "SELF_OFFICIATING"
  | "DUPLICATE_OFFICIAL"
  | "COURT_COLLISION"
  | "PLAYER_DOUBLE_BOOKING"
  | "INSUFFICIENT_REST"
  | "OFFICIAL_DOUBLE_BOOKING"
  | "PLAYER_OFFICIAL_BUFFER"

export type ScheduleConflict = {
  type: ScheduleConflictType
  matchId?: string
  message: string
}

export type ScheduleEntry = {
  id: string
  playerAId: string
  playerBId: string
  playerAPartnerId?: string | null
  playerBPartnerId?: string | null
  courtNumber: number | null
  scheduledTime: string | null
  umpireId?: string | null
  linesmanId?: string | null
  status?: string
}

export type ScheduleCandidate = {
  id?: string
  playerAId: string
  playerBId: string
  playerAPartnerId?: string | null
  playerBPartnerId?: string | null
  courtNumber: number
  scheduledTime: string
  umpireId?: string | null
  linesmanId?: string | null
}

export type SchedulingRules = {
  slotDurationMinutes?: number
  playerRestMinutes?: number
  playerOfficialBufferMinutes?: number
}

const INACTIVE_MATCH_STATUSES = new Set(["CANCELLED", "POSTPONED"])

function players(entry: {
  playerAId: string
  playerBId: string
  playerAPartnerId?: string | null
  playerBPartnerId?: string | null
}): string[] {
  return [entry.playerAId, entry.playerBId, entry.playerAPartnerId, entry.playerBPartnerId].filter((id): id is string => Boolean(id))
}

function officials(entry: {
  umpireId?: string | null
  linesmanId?: string | null
}): string[] {
  return [entry.umpireId, entry.linesmanId].filter(
    (value): value is string => Boolean(value)
  )
}

function overlaps(
  firstStart: number,
  firstEnd: number,
  secondStart: number,
  secondEnd: number
): boolean {
  return firstStart < secondEnd && secondStart < firstEnd
}

function hasEnoughGap(
  firstStart: number,
  firstEnd: number,
  secondStart: number,
  secondEnd: number,
  requiredRestMinutes: number
): boolean {
  const restMs = requiredRestMinutes * 60_000
  return (
    firstEnd + restMs <= secondStart || secondEnd + restMs <= firstStart
  )
}

function describeMatch(matchId?: string): string {
  return matchId ? ` in match ${matchId.slice(0, 8)}` : ""
}

export function validateMatchSchedule(
  candidate: ScheduleCandidate,
  matches: ScheduleEntry[],
  rules: SchedulingRules = {}
): ScheduleConflict[] {
  const slotDurationMinutes = rules.slotDurationMinutes ?? 40
  const playerRestMinutes = rules.playerRestMinutes ?? 20
  const playerOfficialBufferMinutes = rules.playerOfficialBufferMinutes ?? 70
  const conflicts: ScheduleConflict[] = []
  const start = new Date(candidate.scheduledTime).getTime()
  const durationMs = slotDurationMinutes * 60_000
  const end = start + durationMs
  const candidatePlayers = players(candidate)
  const candidateOfficials = officials(candidate)

  if (!Number.isFinite(start)) {
    return [
      {
        type: "INVALID_TIME",
        message: "Choose a valid match start time.",
      },
    ]
  }

  if (candidate.umpireId && candidatePlayers.includes(candidate.umpireId)) {
    conflicts.push({
      type: "SELF_OFFICIATING",
      message: "A player cannot officiate their own match.",
    })
  }
  if (candidate.linesmanId && candidatePlayers.includes(candidate.linesmanId)) {
    conflicts.push({
      type: "SELF_OFFICIATING",
      message: "A player cannot officiate their own match.",
    })
  }
  if (
    candidate.umpireId &&
    candidate.linesmanId &&
    candidate.umpireId === candidate.linesmanId
  ) {
    conflicts.push({
      type: "DUPLICATE_OFFICIAL",
      message: "Choose different people for umpire and linesman.",
    })
  }

  for (const match of matches) {
    if (match.id === candidate.id) continue
    if (match.status && INACTIVE_MATCH_STATUSES.has(match.status)) continue
    if (!match.scheduledTime || !match.courtNumber) continue

    const matchStart = new Date(match.scheduledTime).getTime()
    if (!Number.isFinite(matchStart)) continue
    const matchEnd = matchStart + durationMs
    const matchPlayers = players(match)
    const matchOfficials = officials(match)

    if (
      match.courtNumber === candidate.courtNumber &&
      overlaps(start, end, matchStart, matchEnd)
    ) {
      conflicts.push({
        type: "COURT_COLLISION",
        matchId: match.id,
        message: `Court ${candidate.courtNumber} is already occupied${describeMatch(match.id)}.`,
      })
    }

    const sharedPlayer = candidatePlayers.find((player) =>
      matchPlayers.includes(player)
    )
    if (sharedPlayer) {
      if (overlaps(start, end, matchStart, matchEnd)) {
        conflicts.push({
          type: "PLAYER_DOUBLE_BOOKING",
          matchId: match.id,
          message: "A competitor is already playing in another match at this time.",
        })
      } else if (
        !hasEnoughGap(start, end, matchStart, matchEnd, playerRestMinutes)
      ) {
        conflicts.push({
          type: "INSUFFICIENT_REST",
          matchId: match.id,
          message: `A competitor needs at least ${playerRestMinutes} minutes of rest between matches.`,
        })
      }
    }

    const sharedOfficial = candidateOfficials.find((official) =>
      matchOfficials.includes(official)
    )
    if (
      sharedOfficial &&
      overlaps(start, end, matchStart, matchEnd)
    ) {
      conflicts.push({
        type: "OFFICIAL_DOUBLE_BOOKING",
        matchId: match.id,
        message: "An assigned official is already officiating at this time.",
      })
    }

    const playerActsAsOfficial = candidatePlayers.some((player) =>
      matchOfficials.includes(player)
    )
    const officialActsAsPlayer = candidateOfficials.some((official) =>
      matchPlayers.includes(official)
    )
    if (
      (playerActsAsOfficial || officialActsAsPlayer) &&
      Math.abs(start - matchStart) < playerOfficialBufferMinutes * 60_000
    ) {
      conflicts.push({
        type: "PLAYER_OFFICIAL_BUFFER",
        matchId: match.id,
        message: `A player and an official need a ${playerOfficialBufferMinutes}-minute start-time buffer.`,
      })
    }
  }

  return conflicts
}
