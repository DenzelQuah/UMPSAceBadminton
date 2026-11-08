import type { Match } from "@/app/(dashboard)/tournaments/types"
import { UPCOMING_MATCH_STATUSES } from "./match-status"
import { TBA_MATCH_TIME } from "./match-scheduling"

export function isPlayerInMatch(match:Match,playerId:string) {
  return [match.player_a_id,match.player_b_id,match.player_a_partner_id,match.player_b_partner_id].includes(playerId)
}

export function playerOpponent(match:Match,playerId:string) {
  if (match.player_a_id === playerId || match.player_a_partner_id === playerId) return match.player_b_name || "Opponent to be confirmed"
  if (match.player_b_id === playerId || match.player_b_partner_id === playerId) return match.player_a_name || "Opponent to be confirmed"
  return "Opponent to be confirmed"
}

export function playerWonMatch(match:Match,playerId:string) {
  if (!match.winner_id || !isPlayerInMatch(match,playerId)) return false
  const representative = match.player_a_id === playerId || match.player_a_partner_id === playerId ? match.player_a_id : match.player_b_id
  return match.winner_id === representative
}

function effectiveTime(match:Pick<Match,"scheduled_time"|"estimated_start_time">) {
  return [match.estimated_start_time,match.scheduled_time].find((value) => value && Number.isFinite(Date.parse(value))) ?? null
}

export function scheduledPlayerMatches(matches:Match[],playerId:string):Match[] {
  const ended = ["COMPLETED","ARCHIVED","CANCELLED"]
  return matches.filter((match) => isPlayerInMatch(match,playerId)
    && (UPCOMING_MATCH_STATUSES as readonly string[]).includes(match.status)
    && !ended.includes(match.category_status ?? "") && !ended.includes(match.tournament_status ?? ""))
    .sort((a,b) => {
      if ((a.status === "IN_PROGRESS") !== (b.status === "IN_PROGRESS")) return a.status === "IN_PROGRESS" ? -1 : 1
      if ((a.status === "POSTPONED") !== (b.status === "POSTPONED")) return a.status === "POSTPONED" ? 1 : -1
      const aTime = Date.parse(effectiveTime(a) ?? "")
      const bTime = Date.parse(effectiveTime(b) ?? "")
      const aScheduled = Number.isFinite(aTime), bScheduled = Number.isFinite(bTime)
      if (aScheduled !== bScheduled) return aScheduled ? -1 : 1
      if (aScheduled && bScheduled && aTime !== bTime) return aTime-bTime
      return a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)
    })
}

export function playerMatchTime(match:Pick<Match,"status"|"scheduled_time"|"estimated_start_time">) {
  if (match.status === "POSTPONED") return "Awaiting a new schedule"
  const time = effectiveTime(match)
  if (!time) return TBA_MATCH_TIME
  const estimated = Date.parse(time) !== Date.parse(match.scheduled_time ?? "")
  return `${estimated ? "Estimated: " : ""}${new Intl.DateTimeFormat("en-MY",{ dateStyle:"medium",timeStyle:"short",timeZone:"Asia/Kuala_Lumpur" }).format(new Date(time))}`
}
