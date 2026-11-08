import Link from "next/link"
import { redirect } from "next/navigation"
import { CalendarDays,Clock3,MapPin,Trophy } from "lucide-react"
import { getPlayerMatches,getPlayerStandings,getUpcomingPlayerMatches,type PlayerStanding } from "@/app/actions/matches"
import { getCurrentUserWithRoles } from "@/app/actions/user"
import type { Match } from "@/app/(dashboard)/tournaments/types"
import AutoRefresh from "@/components/AutoRefresh"
import { getMatchStageLabel } from "@/lib/tournament/stages"
import { playerMatchTime,playerOpponent,playerWonMatch } from "@/lib/tournament/player-schedule"
import { Card,CardContent,CardDescription,CardHeader,CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import MatchScheduleLink from "@/components/MatchScheduleLink"

function PlayerMatchCard({ match,playerId,showResult,canManage }: { match:Match;playerId:string;showResult:boolean;canManage:boolean }) {
  const postponed = match.status === "POSTPONED"
  const result = match.status === "CANCELLED" ? "Match cancelled" : match.winner_id ? playerWonMatch(match,playerId) ? "You won" : "Result: loss" : "Result pending"
  return <Card className={match.status === "IN_PROGRESS" ? "border-emerald-300" : ""}>
    <CardHeader>
      {(match.tournament_title || match.category_name) && <p className="text-xs font-semibold text-muted-foreground">{[match.tournament_title,match.category_name].filter(Boolean).join(" · ")}</p>}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <CardTitle className="text-xl">vs {playerOpponent(match,playerId)}</CardTitle>
        <Badge variant="outline" className={match.status === "IN_PROGRESS" ? "border-emerald-300 bg-emerald-50 text-emerald-900" : ""}>{match.status === "IN_PROGRESS" ? "Live now" : match.status === "SCHEDULED" && !match.scheduled_time && !match.estimated_start_time ? "Time TBA" : match.status.replaceAll("_"," ").toLowerCase()}</Badge>
      </div>
      <CardDescription>{getMatchStageLabel(match)}{match.group_round ? ` · Round ${match.group_round}` : ""}</CardDescription>
    </CardHeader>
    <CardContent className="space-y-3 text-sm">
      <p className="flex items-center gap-2"><Clock3 className="size-4 shrink-0 text-primary" aria-hidden="true" />{showResult && !match.scheduled_time && !match.estimated_start_time ? "No scheduled time recorded" : playerMatchTime(match)}</p>
      <div className="flex items-start gap-2"><MapPin className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" /><div><p>{!postponed && match.court_number ? `Court ${match.court_number}` : "Court assignment pending"}</p><p className="mt-1 text-muted-foreground">{match.tournament_location || "Venue to be confirmed"}</p></div></div>
      {showResult && <p className="border-t pt-3 font-semibold text-primary">{result}</p>}
      {!showResult && <MatchScheduleLink match={match} tournamentId={match.tournament_id} canManage={canManage} />}
    </CardContent>
  </Card>
}

function Standings({ standings }: { standings:PlayerStanding[] }) {
  return <Card><CardHeader><CardTitle>Group standings</CardTitle><CardDescription>Your published group tables</CardDescription></CardHeader><CardContent>
    <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="border-b text-xs uppercase tracking-wider text-muted-foreground"><tr>{["Group","Player","Pld","W","L","PW","PL","NP","Pts"].map((label) => <th key={label} className="px-3 py-3">{label}</th>)}</tr></thead><tbody>{standings.map((standing) => <tr key={standing.id} className="border-b last:border-0"><td className="px-3 py-3">{standing.group_name}</td><td className="px-3 py-3 font-semibold">{standing.player_name}</td><td className="px-3 py-3">{standing.matches_played}</td><td className="px-3 py-3">{standing.matches_won}</td><td className="px-3 py-3">{standing.matches_lost}</td><td className="px-3 py-3">{standing.points_won}</td><td className="px-3 py-3">{standing.points_lost}</td><td className="px-3 py-3 font-bold text-primary">{standing.net_points}</td><td className="px-3 py-3 font-bold">{standing.standings_points}</td></tr>)}</tbody></table></div>
  </CardContent></Card>
}

export default async function MatchesPage({ searchParams }: { searchParams:Promise<{ view?:string | string[] }> }) {
  const [params,user] = await Promise.all([searchParams,getCurrentUserWithRoles()])
  if (!user) redirect("/login")
  const showResults = params.view === "results"
  const [response,standingsResponse] = await Promise.all([
    showResults ? getPlayerMatches() : getUpcomingPlayerMatches(),
    showResults ? getPlayerStandings() : Promise.resolve(null),
  ])
  const fixtures = !response.success ? [] : showResults
    ? response.data.filter((match) => ["COMPLETED","WALKOVER","RETIRED","CANCELLED"].includes(match.status)).sort((a,b) => (b.scheduled_time ?? b.created_at).localeCompare(a.scheduled_time ?? a.created_at))
    : response.data

  return <div className="mx-auto w-full max-w-6xl space-y-6">
    <AutoRefresh />
    <section className="rounded-2xl bg-primary p-6 text-primary-foreground sm:p-8"><h1 className="flex items-center gap-3 text-3xl font-bold"><CalendarDays className="size-8 shrink-0" aria-hidden="true" />Draw / Schedule</h1><p className="mt-3 text-sm text-blue-50">Your matches across all tournaments, including doubles. Times are shown in Malaysia time (MYT).</p></section>
    <nav className="flex flex-wrap gap-2" aria-label="Match views">{[{ href:"/matches",label:"Upcoming matches",active:!showResults },{ href:"/matches?view=results",label:"Results & standings",active:showResults }].map((tab) => <Link key={tab.href} href={tab.href} aria-current={tab.active ? "page" : undefined} className={`inline-flex min-h-12 items-center rounded-lg border px-4 text-sm font-semibold ${tab.active ? "bg-primary text-white" : "bg-white text-primary"}`}>{tab.label}</Link>)}</nav>
    {user.roles.isOrganizer && <aside className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-blue-200 bg-blue-50 p-4"><div><h2 className="text-sm font-bold text-primary">MT scheduling tools</h2><p className="mt-1 text-sm text-slate-700">Set a time for any TBA match below, or open tournament management for the full schedule.</p></div><Link href="/admin" className="inline-flex min-h-12 items-center rounded-lg border bg-white px-4 text-sm font-semibold text-primary hover:bg-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Manage tournament schedules</Link></aside>}
    {!response.success ? <Card><CardHeader><CardTitle>Matches could not be loaded</CardTitle><CardDescription role="alert">{response.error.message} This page refreshes automatically.</CardDescription></CardHeader></Card> : fixtures.length === 0 ? <Card><CardHeader className="py-10 text-center"><Trophy className="mx-auto mb-2 size-9 text-primary" aria-hidden="true" /><CardTitle>{showResults ? "No results yet" : "No upcoming matches"}</CardTitle><CardDescription>{showResults ? "Your completed matches will appear here once results are recorded." : "You have no upcoming matches scheduled at this time."}</CardDescription>{!showResults && <p className="mx-auto mt-2 max-w-lg text-sm text-muted-foreground">Fixtures appear after the draw is published and your opponent is confirmed. If your tournament run has ended, you can review your results in the next tab.</p>}<Link href="/tournaments" className="mx-auto mt-3 inline-flex min-h-12 items-center rounded-lg border px-4 text-sm font-semibold text-primary">Browse tournaments</Link></CardHeader></Card> : <section className="space-y-4" aria-label={showResults ? "Your match results" : "Your upcoming matches"}><p className="text-sm text-muted-foreground">{fixtures.length} {showResults ? "recorded" : "upcoming"} match{fixtures.length === 1 ? "" : "es"}</p><div className="grid gap-4 md:grid-cols-2">{fixtures.map((match) => <PlayerMatchCard key={match.id} match={match} playerId={user.user.id} showResult={showResults} canManage={user.roles.isOrganizer} />)}</div></section>}
    {showResults && standingsResponse && (!standingsResponse.success ? <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">{standingsResponse.error.message}</p> : standingsResponse.data.length > 0 && <Standings standings={standingsResponse.data} />)}
  </div>
}
