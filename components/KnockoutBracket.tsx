import { BadgeCheck, CircleDashed, Trophy } from "lucide-react"

import type { Match } from "@/app/(dashboard)/tournaments/types"
import type { BracketPayload } from "@/lib/tournament/bracket"
import type { LiveScores } from "@/lib/realtime/live-scores"
import MatchScoreLine from "@/components/MatchScoreLine"
import MatchOfficialAssignmentLink from "@/components/MatchOfficialAssignmentLink"
import MatchScheduleLink from "@/components/MatchScheduleLink"
import { playerMatchTime } from "@/lib/tournament/player-schedule"

interface KnockoutBracketProps {
  bracket: BracketPayload
  matches?: Match[]
  title?: string
  scores?: LiveScores
  canAssignOfficials?: boolean
  managementTournamentId?: string
}

export default function KnockoutBracket({
  bracket,
  matches = [],
  title = "Knockout bracket",
  scores,
  canAssignOfficials=false,
  managementTournamentId,
}: KnockoutBracketProps) {
  const matchById = new Map(matches.map((match) => [match.id, match]))
  const seedByPlayerId = new Map(bracket.seeds.map((seed) => [seed.player_id, seed]))

  return (
    <section className="space-y-4" aria-labelledby="knockout-bracket-heading">
      <div>
        <h3 id="knockout-bracket-heading" className="flex items-center gap-2 text-lg font-bold">
          <Trophy className="size-5 text-amber-600" aria-hidden="true" />
          {title}
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {bracket.qualifier_count} entries · {bracket.bracket_size ?? bracket.qualifier_count} bracket places · {bracket.bye_count ?? 0} byes
        </p>
      </div>

      <div className="overflow-x-auto pb-3">
        <div className="flex min-w-max gap-4">
          {bracket.rounds.map((round) => (
            <div key={round.round} className="w-60 shrink-0 space-y-3">
              <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                <h4 className="text-sm font-bold text-slate-800">{round.label}</h4>
                <span className="text-xs text-slate-400">Round {round.round}</span>
              </div>
              {round.pairings.map((pairing) => {
                const match = pairing.match_id ? matchById.get(pairing.match_id) : undefined
                const playerAName =
                  match?.player_a_name ??
                  (pairing.player_a_id ? seedByPlayerId.get(pairing.player_a_id)?.player_name : null) ??
                  "TBD"
                const playerBName =
                  match?.player_b_name ??
                  (pairing.player_b_id ? seedByPlayerId.get(pairing.player_b_id)?.player_name : null) ??
                  (pairing.bye_player_id ? "BYE" : "TBD")
                const score=pairing.match_id ? scores?.[pairing.match_id]:undefined
                const status=score?.status ?? match?.status
                const completed = !!pairing.bye_player_id || status === "COMPLETED" || status === "WALKOVER" || status === "RETIRED"
                const winnerId = score ? score.winner_id : match?.winner_id
                return (
                  <div
                    key={`${round.round}-${pairing.index}`}
                    className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm"
                  >
                    <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-wide text-slate-400">
                      <span>{pairing.bye_player_id ? "Bye" : `Match ${pairing.index}`}</span>
                      {completed ? <BadgeCheck className="size-4 text-emerald-600" aria-label="Completed" /> : <CircleDashed className="size-4 text-slate-400" aria-label="Pending" />}
                    </div>
                    <div className="space-y-1 text-sm">
                      <p className={winnerId && winnerId === match?.player_a_id ? "font-bold text-emerald-700" : "text-slate-700"}>{playerAName}</p>
                      <p className={winnerId && winnerId === match?.player_b_id ? "font-bold text-emerald-700" : "text-slate-700"}>{playerBName}</p>
                    </div>
                    {scores && pairing.match_id && !pairing.bye_player_id && <MatchScoreLine score={score} />}
                    <p className="mt-3 text-xs text-slate-500">
                      {pairing.bye_player_id ? "BYE · Advances automatically" : status ? status.replaceAll("_", " ") : "Awaiting participants"}
                    </p>
                    {!pairing.bye_player_id && <p className="mt-2 text-xs text-slate-500">Time: {match ? playerMatchTime(match) : "TBA — awaiting opponents"}</p>}
                    {!match && !pairing.bye_player_id && managementTournamentId && <p className="mt-2 text-xs leading-5 text-muted-foreground">MT can set the time once both opponents are confirmed.</p>}
                    {match && !pairing.bye_player_id && (managementTournamentId || canAssignOfficials) && <div className="mt-3 flex flex-wrap gap-2"><MatchScheduleLink match={{...match,status:status ?? match.status}} tournamentId={managementTournamentId} canManage={!!managementTournamentId} /><MatchOfficialAssignmentLink matchId={match.id} canAssign={canAssignOfficials} status={status ?? match.status} /></div>}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
