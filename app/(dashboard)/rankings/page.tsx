import { Users, Trophy, Clock3 } from "lucide-react"
import { getGlobalRankings } from "@/app/actions/rankings"
import { getCurrentUserWithRoles } from "@/app/actions/user"
import AutoRefresh from "@/components/AutoRefresh"
import LeagueTable from "@/components/LeagueTable"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export default async function RankingsPage() {
  const [result, user] = await Promise.all([getGlobalRankings(), getCurrentUserWithRoles()])
  const rankings = result.success ? result.data : []
  const published = rankings.filter((player) => player.matches_played > 0).length
  return (
    <div className="mx-auto w-full max-w-[1450px] space-y-6">
      <AutoRefresh intervalMs={15000} />
      <section className="relative overflow-hidden rounded-2xl bg-primary p-6 text-primary-foreground sm:p-8">
        <div className="absolute inset-y-0 right-0 w-2 bg-secondary" aria-hidden="true" />
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-100">UMPSAce Badminton</p>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-5">
          <div><h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">League standings</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-blue-50">Every tournament entrant, one league table. Earn points across singles and doubles when tournament results are officially published.</p></div>
          <div className="rounded-xl border border-white/20 bg-white/10 p-4 text-sm"><p className="font-bold text-secondary">How points add up</p><p className="mt-1 text-blue-50">3 per match win + 1 per game won + 1 per participation</p></div>
        </div>
      </section>
      {!result.success ? <Card className="border-red-200 bg-red-50"><CardHeader><CardTitle className="text-red-900">Standings unavailable</CardTitle><CardDescription className="text-red-800">{result.error.message}</CardDescription></CardHeader></Card> : <>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[{ label: "Tournament entrants", value: rankings.length, Icon: Users }, { label: "With published results", value: published, Icon: Trophy }, { label: "Awaiting first result", value: rankings.length - published, Icon: Clock3 }].map(({ label, value, Icon }) => <div key={label} className="flex items-center gap-3 rounded-xl border bg-white p-4"><Icon className="size-5 text-primary" aria-hidden="true" /><div><p className="text-xs text-muted-foreground">{label}</p><p className="text-xl font-bold text-primary">{value}</p></div></div>)}
        </div>
        {rankings.length === 0 ? <Card className="border-dashed"><CardContent className="px-6 py-14 text-center"><Users className="mx-auto size-9 text-primary" aria-hidden="true" /><h2 className="mt-4 font-bold">No tournament entrants yet</h2><p className="mt-2 text-sm text-muted-foreground">Players appear here as soon as they enter a category. Accepted doubles partners are listed individually, starting with zero points.</p></CardContent></Card> : <Card className="overflow-hidden border-slate-200 shadow-sm"><LeagueTable rankings={rankings} currentUserId={user?.user.id} /></Card>}
        <p className="text-xs leading-5 text-muted-foreground">Statistics and points are published when the committee completes a tournament. Ties are settled by net points, match wins, win percentage, then the latest head-to-head result when exactly two players remain tied.</p>
      </>}
    </div>
  )
}
