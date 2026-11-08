import { ArrowRight, CalendarClock, Gavel, MapPin, UserCheck } from "lucide-react"
import Link from "next/link"

import { getAssignedMatches } from "@/app/actions/matchOperations"
import { getCurrentUserWithRoles } from "@/app/actions/user"
import AutoRefresh from "@/components/AutoRefresh"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

function formatTime(value: string | null): string {
  if (!value) return "Awaiting schedule"
  return new Intl.DateTimeFormat("en-MY", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value))
}

export default async function UmpireDashboardPage() {
  const [result, user] = await Promise.all([
    getAssignedMatches(),
    getCurrentUserWithRoles(),
  ])
  const matches = result.success ? result.data : []
  const isAdmin = user?.roles.isOrganizer === true

  return (
    <div className="mx-auto w-full max-w-5xl space-y-7">
      <AutoRefresh />
      <section className="rounded-2xl bg-primary p-6 text-primary-foreground shadow-sm sm:p-8">
        <Badge variant="outline" className="mb-3 border-white/25 bg-white/10 text-white">
          <UserCheck className="size-3.5" aria-hidden="true" />
          {isAdmin ? "Committee scoring workspace" : "Official workspace"}
        </Badge>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          {isAdmin ? "Scoring consoles" : "Your assigned courts"}
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-blue-50 sm:text-base">
          {isAdmin
            ? "Open any published match to start or review scoring. Terminal matches remain available as read-only history."
            : "Review your umpire and linesman assignments. Umpire duties include scoring controls; linesman duties are read-only. Completed assignments remain available as history."}
        </p>
      </section>

      {!result.success ? (
        <Card className="border-red-200 bg-red-50">
          <CardHeader>
            <CardTitle className="text-red-900">Assigned matches unavailable</CardTitle>
            <CardDescription className="text-red-800">{result.error.message}</CardDescription>
          </CardHeader>
        </Card>
      ) : matches.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center px-6 py-16 text-center">
            <div className="flex size-14 items-center justify-center rounded-2xl bg-amber-50 text-amber-700"><Gavel className="size-7" aria-hidden="true" /></div>
            <h2 className="mt-4 text-base font-semibold">
              {isAdmin ? "No published matches yet" : "No court assignments yet"}
            </h2>
            <p className="mt-1 max-w-md text-sm leading-6 text-muted-foreground">
              {isAdmin
                ? "Published matches will appear here as soon as the committee generates and publishes a draw."
                : "The committee will assign your umpire or linesman duties before match day. Your assignments will appear here."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {matches.map((match) => (
            <Card key={match.id} className="border-slate-200 shadow-sm transition hover:border-blue-300 hover:shadow-md">
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-lg">{match.player_a_name ?? "Player A"} <span className="font-normal text-slate-400">vs</span> {match.player_b_name ?? "Player B"}</CardTitle>
                    <CardDescription>Match operations console</CardDescription>
                  </div>
                  <Badge variant="outline" className={match.status === "IN_PROGRESS" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-blue-200 bg-blue-50 text-blue-800"}>{match.status.replaceAll("_", " ")}</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
                  <span className="inline-flex items-center gap-2"><CalendarClock className="size-4" aria-hidden="true" />{formatTime(match.scheduled_time)}</span>
                  <span className="inline-flex items-center gap-2"><MapPin className="size-4" aria-hidden="true" />{match.court_number ? `Court ${match.court_number}` : "Court pending"}</span>
                </div>
                {isAdmin || match.umpire_id === user?.user.id ? <Button nativeButton={false} render={<Link href={`/umpire/court/${match.id}`} />} className="min-h-11 w-full gap-2">
                  Open scoring console
                  <ArrowRight className="size-4" aria-hidden="true" />
                </Button> : <p className="rounded-lg bg-blue-50 p-3 text-sm text-blue-900">Linesman duty · Read-only assignment</p>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
