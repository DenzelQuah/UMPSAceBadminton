export type ScoringFormat = "STANDARD_3X21" | "SINGLE_SET_1X30"

export type GameScore = {
  gameNumber: number
  playerAScore: number
  playerBScore: number
}

export type GameState = "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED" | "INVALID"

export function isGameComplete(
  format: ScoringFormat,
  playerAScore: number,
  playerBScore: number
): boolean {
  if (format === "SINGLE_SET_1X30") {
    return playerAScore === 30 || playerBScore === 30
  }

  const higher = Math.max(playerAScore, playerBScore)
  const lower = Math.min(playerAScore, playerBScore)
  if (higher < 21) return false
  if (higher === 30) return lower <= 29
  return higher - lower >= 2
}

export function getGameState(
  format: ScoringFormat,
  playerAScore: number,
  playerBScore: number
): GameState {
  if (
    !Number.isInteger(playerAScore) ||
    !Number.isInteger(playerBScore) ||
    playerAScore < 0 ||
    playerBScore < 0
  ) {
    return "INVALID"
  }

  if (format === "SINGLE_SET_1X30") {
    if (playerAScore > 30 || playerBScore > 30) return "INVALID"
    if (playerAScore === 30 && playerBScore === 30) return "INVALID"
  } else {
    if (playerAScore > 30 || playerBScore > 30) return "INVALID"
    if (playerAScore === 30 && playerBScore === 30) return "INVALID"
  }

  if (isGameComplete(format, playerAScore, playerBScore)) return "COMPLETED"
  if (playerAScore === 0 && playerBScore === 0) return "NOT_STARTED"
  return "IN_PROGRESS"
}

export function validateGameScore(
  format: ScoringFormat,
  gameNumber: number,
  playerAScore: number,
  playerBScore: number
): { valid: true } | { valid: false; message: string } {
  if (!Number.isInteger(gameNumber) || gameNumber < 1) {
    return { valid: false, message: "Game number must be a positive whole number." }
  }
  if (format === "SINGLE_SET_1X30" && gameNumber > 1) {
    return { valid: false, message: "This format contains one game only." }
  }
  if (format === "STANDARD_3X21" && gameNumber > 3) {
    return { valid: false, message: "A standard match contains at most three games." }
  }

  const state = getGameState(format, playerAScore, playerBScore)
  if (state === "INVALID") {
    return {
      valid: false,
      message:
        format === "SINGLE_SET_1X30"
          ? "A 30-point game cannot continue beyond 30–29."
          : "A standard game cannot continue beyond 30–29 or 30–30.",
    }
  }

  return { valid: true }
}

export function isMatchComplete(
  format: ScoringFormat,
  games: GameScore[]
): boolean {
  if (format === "SINGLE_SET_1X30") {
    return games.some(
      (game) =>
        game.gameNumber === 1 &&
        getGameState(format, game.playerAScore, game.playerBScore) === "COMPLETED"
    )
  }

  const completedWins = { A: 0, B: 0 }
  for (const game of games) {
    const state = getGameState(format, game.playerAScore, game.playerBScore)
    if (state !== "COMPLETED") continue
    if (game.playerAScore > game.playerBScore) completedWins.A += 1
    if (game.playerBScore > game.playerAScore) completedWins.B += 1
  }
  return completedWins.A === 2 || completedWins.B === 2
}

export function getMatchWinner(
  format: ScoringFormat,
  games: GameScore[]
): "player_a" | "player_b" | null {
  if (!isMatchComplete(format, games)) return null
  if (format === "SINGLE_SET_1X30") {
    const game = games.find((item) => item.gameNumber === 1)
    if (!game) return null
    return game.playerAScore > game.playerBScore ? "player_a" : "player_b"
  }

  let playerAWins = 0
  let playerBWins = 0
  for (const game of games) {
    if (getGameState(format, game.playerAScore, game.playerBScore) !== "COMPLETED") continue
    if (game.playerAScore > game.playerBScore) playerAWins += 1
    if (game.playerBScore > game.playerAScore) playerBWins += 1
  }
  return playerAWins > playerBWins ? "player_a" : "player_b"
}

export function getIntervalSeconds(
  format: ScoringFormat,
  playerAScore: number,
  playerBScore: number
): number | null {
  if (format === "STANDARD_3X21" && (playerAScore === 11 || playerBScore === 11)) {
    return 60
  }
  if (format === "SINGLE_SET_1X30" && (playerAScore === 15 || playerBScore === 15)) {
    return 120
  }
  return null
}

export function hasReachedIntervalThreshold(
  format: ScoringFormat,
  playerAScore: number,
  playerBScore: number
): boolean {
  const threshold = format === "STANDARD_3X21" ? 11 : 15
  return Math.max(playerAScore, playerBScore) >= threshold
}

export type ScoreSnapshot = {
  playerAScore: number
  playerBScore: number
}

export function getBetweenGameIntervalSeconds(
  format: ScoringFormat
): number | null {
  return format === "STANDARD_3X21" ? 120 : null
}

/**
 * Returns the next game that should be played after a completed game.
 * A missing game row is treated as an unstarted game.
 */
export function getNextIncompleteGameNumber(
  format: ScoringFormat,
  games: GameScore[],
  completedGameNumber: number
): number | null {
  if (format === "SINGLE_SET_1X30") return null

  for (let gameNumber = completedGameNumber + 1; gameNumber <= 3; gameNumber += 1) {
    const game = games.find((item) => item.gameNumber === gameNumber)
    if (!game || getGameState(format, game.playerAScore, game.playerBScore) !== "COMPLETED") {
      return gameNumber
    }
  }

  return null
}

/**
 * Returns an interval duration only when a game crosses its threshold.
 *
 * Comparing the previous and next scores prevents a later point (for example
 * 11-1 after 11-0) from repeatedly restarting the same interval.
 */
export function getCrossingIntervalSeconds(
  format: ScoringFormat,
  previous: ScoreSnapshot,
  next: ScoreSnapshot
): number | null {
  if (hasReachedIntervalThreshold(format, previous.playerAScore, previous.playerBScore)) {
    return null
  }
  if (!hasReachedIntervalThreshold(format, next.playerAScore, next.playerBScore)) {
    return null
  }
  return format === "STANDARD_3X21" ? 60 : 120
}
