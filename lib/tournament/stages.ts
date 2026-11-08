export type MatchStageInput = {
  group_id?: string | null
  knockout_round?: number | null
  knockout_stage?: string | null
}

/**
 * Human-readable stage label for a fixture. Knockout round numbering is the
 * order played: 1 = quarter-final, 2 = semi-final, 3 = final.
 */
export function getMatchStageLabel(match: MatchStageInput): string {
  if (match.knockout_stage) return match.knockout_stage

  if (match.knockout_round !== null && match.knockout_round !== undefined) {
    switch (match.knockout_round) {
      case 1:
        return "Quarter-final"
      case 2:
        return "Semi-final"
      case 3:
        return "Final"
      default:
        return `Knockout round ${match.knockout_round}`
    }
  }

  if (match.group_id) return "Group stage"
  return "Match"
}
