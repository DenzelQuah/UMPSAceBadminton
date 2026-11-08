"use client"

import { useId, useState } from "react"
import { Search } from "lucide-react"
import type { GlobalRanking } from "@/app/actions/rankings"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

const columns = [
  ["P", "Published matches played, including walkovers"],
  ["W", "Matches won"], ["L", "Matches lost"], ["GW", "Games won"],
  ["PF", "Rally points scored"], ["PA", "Rally points conceded"],
  ["NP", "Net rally points: points scored minus points conceded"],
  ["Apps", "Participation credits; walkover absentees receive none"],
  ["Win %", "Match wins divided by matches played"],
] as const

export default function LeagueTable({ rankings, currentUserId }: { rankings: GlobalRanking[]; currentUserId?: string }) {
  const searchId = useId()
  const [search, setSearch] = useState("")
  const visible = rankings.filter((player) => player.full_name.toLowerCase().includes(search.trim().toLowerCase()))
  return <div>
    <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-end sm:justify-between sm:p-5">
      <div>
        <p className="font-bold text-primary">Player standings</p>
        <p className="mt-1 text-xs text-muted-foreground" aria-live="polite">{visible.length} of {rankings.length} players · Positions stay the same when searching</p>
      </div>
      <div className="w-full sm:max-w-72">
        <label htmlFor={searchId} className="mb-1 block text-xs font-semibold text-slate-700">Find a player</label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-4 size-4 text-slate-500" aria-hidden="true" />
          <Input id={searchId} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by player name" className="min-h-12 pl-9" type="search" />
        </div>
      </div>
    </div>
    <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Scrollable league standings" style={{ outlineOffset: -2 }}>
      <table className="w-full min-w-[1100px] border-collapse text-left text-sm tabular-nums">
        <caption className="sr-only">UMPSAce league standings. Ordered by ranking points, net rally points, match wins, win percentage and the latest head-to-head result for two tied players. Unresolved ties share a position.</caption>
        <thead className="bg-primary text-primary-foreground">
          <tr>
            <th scope="col" className="sticky left-0 z-20 w-14 min-w-14 bg-primary px-3 py-4 text-center text-xs">Pos</th>
            <th scope="col" className="sticky left-14 z-20 min-w-44 bg-primary px-4 py-4 text-xs">Player</th>
            {columns.map(([label, description]) => <th key={label} scope="col" className="px-3 py-4 text-center text-xs font-semibold"><abbr title={description} className="cursor-help no-underline">{label}</abbr></th>)}
            <th scope="col" className="min-w-36 px-3 py-4 text-center text-xs">Last 5</th>
            <th scope="col" className="bg-white/10 px-5 py-4 text-center text-xs"><abbr title="Ranking points: three per match win, one per game won and one per participation credit" className="cursor-help no-underline">Pts</abbr></th>
          </tr>
        </thead>
        <tbody>
          {visible.map((player) => {
            const isCurrent = player.profile_id === currentUserId
            const rowBackground = isCurrent ? "bg-blue-50" : "bg-white"
            return <tr key={player.profile_id} aria-current={isCurrent ? "true" : undefined} className={cn("group border-b border-slate-100 last:border-0", rowBackground)}>
              <td className={cn("sticky left-0 z-10 border-l-4 px-3 py-5 text-center font-bold", rowBackground,
                player.rank_position === 1 && player.matches_played > 0 ? "border-l-secondary text-primary" : "border-l-transparent text-slate-600")}>
                {player.rank_position}
              </td>
              <th scope="row" className={cn("sticky left-14 z-10 px-4 py-4 font-semibold text-slate-900", rowBackground)}>
                <div className="flex items-center gap-2"><span>{player.full_name}</span>{isCurrent && <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-blue-900">You</span>}</div>
                {player.matches_played === 0 && <span className="mt-1 block text-xs font-normal text-slate-500">Awaiting first published result</span>}
              </th>
              {[player.matches_played, player.matches_won, player.matches_lost, player.games_won, player.points_won, player.points_lost].map((value, index) => <td key={index} className="px-3 py-5 text-center text-slate-700">{value}</td>)}
              <td className={cn("px-3 py-5 text-center font-semibold", player.net_points > 0 ? "text-emerald-800" : "text-slate-700")}>{player.net_points > 0 ? "+" : ""}{player.net_points}</td>
              <td className="px-3 py-5 text-center text-slate-700">{player.participations}</td>
              <td className="px-3 py-5 text-center text-slate-700">{Number(player.win_percentage).toFixed(2)}%</td>
              <td className="px-3 py-5">
                {player.recent_form.length === 0 ? <span className="block text-center text-slate-400" aria-label="No published results">—</span> : <div className="flex justify-center gap-1" aria-label={`Recent results, oldest to newest: ${player.recent_form.map((result) => result === "W" ? "win" : "loss").join(", ")}`}>
                  {player.recent_form.map((result, index) => <span key={index} aria-hidden="true" className={cn("flex size-6 items-center justify-center rounded text-[10px] font-bold", result === "W" ? "bg-emerald-100 text-emerald-900" : "bg-slate-200 text-slate-700")}>{result}</span>)}
                </div>}
              </td>
              <td className="bg-blue-50/70 px-5 py-5 text-center text-lg font-extrabold text-primary">{player.ranking_points}</td>
            </tr>
          })}
          {visible.length === 0 && <tr><td colSpan={13} className="px-5 py-12 text-center text-muted-foreground">No players match your search.</td></tr>}
        </tbody>
      </table>
    </div>
    <div className="space-y-2 border-t bg-slate-50 p-4 text-xs leading-5 text-slate-600 sm:p-5">
      <p><strong className="text-slate-800">P</strong> played · <strong>W/L</strong> wins/losses · <strong>GW</strong> games won · <strong>PF/PA</strong> rally points for/against · <strong>NP</strong> net points · <strong>Apps</strong> participation credits.</p>
      <p>Last 5 runs from oldest to newest. Walkover absentees record a loss and receive zero points. Unresolved ties share a position; names only determine display order within a tie.</p>
    </div>
  </div>
}
