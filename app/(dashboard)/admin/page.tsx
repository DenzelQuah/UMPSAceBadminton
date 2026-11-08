import {
  Activity,
  ArrowRight,
  CalendarClock,
  CircleAlert,
  ClipboardCheck,
  MapPin,
  Settings2,
  ShieldCheck,
  Trophy,
  UserCog,
  Users,
} from "lucide-react"
import Link from "next/link"

import {
  getAdminTournaments,
  getCommitteeOverview,
} from "@/app/actions/tournaments"
import { getRecentCommitteeActivity } from "@/app/actions/matches"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { CreateTournamentDialog } from "./CreateTournamentDialog"
import { getTournamentFeatureStatus } from "@/app/actions/setup"
import DatabaseSetupNotice from "@/components/DatabaseSetupNotice"
import { getCurrentUserWithRoles } from "@/app/actions/user"

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-MY", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value))
}

function statusLabel(status: string | null | undefined): string {
  return (status ?? "DRAFT")
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
}

function statusClass(status: string | null | undefined): string {
  const normalizedStatus = status ?? "DRAFT"
  if (["COMPLETED", "ARCHIVED"].includes(normalizedStatus)) {
    return "border-slate-200 bg-slate-100 text-slate-800"
  }
  if (normalizedStatus === "REGISTRATION_OPEN") {
    return "border-blue-200 bg-blue-50 text-blue-800"
  }
  if (["DRAW_PUBLISHED", "GROUP_STAGE_IN_PROGRESS"].includes(normalizedStatus)) {
    return "border-emerald-200 bg-emerald-50 text-emerald-800"
  }
  return "border-amber-200 bg-amber-50 text-amber-900"
}

function activityLabel(action: string): string {
  return action
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
}

export default async function AdminPage() {
  const [tournamentsResult, overviewResult, activityResult, featuresResult, user] = await Promise.all([
    getAdminTournaments(),
    getCommitteeOverview(),
    getRecentCommitteeActivity(),
    getTournamentFeatureStatus(),
    getCurrentUserWithRoles(),
  ])
  const tournaments = tournamentsResult.success ? tournamentsResult.data : []
  const overview = overviewResult.success
    ? overviewResult.data
    : {
        tournamentCount: 0,
        openCategoryCount: 0,
        confirmedPlayerCount: 0,
        unscheduledMatchCount: 0,
        liveMatchCount: 0,
      }
  const activity = activityResult.success ? activityResult.data : []

  const metrics = [
    {
      label: "Tournaments",
      value: overview.tournamentCount,
      detail: "Drafts through archived events",
      icon: Trophy,
      iconClass: "bg-blue-50 text-blue-700",
    },
    {
      label: "Open categories",
      value: overview.openCategoryCount,
      detail: "Accepting player registrations",
      icon: ClipboardCheck,
      iconClass: "bg-cyan-50 text-cyan-700",
    },
    {
      label: "Confirmed players",
      value: overview.confirmedPlayerCount,
      detail: "Across all active categories",
      icon: Users,
      iconClass: "bg-violet-50 text-violet-700",
    },
    {
      label: "Needs scheduling",
      value: overview.unscheduledMatchCount,
      detail: `${overview.liveMatchCount} currently live`,
      icon: CalendarClock,
      iconClass: "bg-amber-50 text-amber-800",
    },
  ]

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-7">
      {featuresResult.success && <DatabaseSetupNotice features={featuresResult.data} />}
      <section className="relative overflow-hidden rounded-2xl bg-primary px-5 py-6 text-primary-foreground shadow-sm sm:px-7 sm:py-7">
        <div className="absolute -right-12 -top-16 size-56 rounded-full bg-white/10" aria-hidden="true" />
        <div className="absolute -bottom-20 right-28 size-44 rounded-full bg-secondary/20" aria-hidden="true" />
        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-3xl">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold tracking-wide uppercase">
              <ShieldCheck className="size-3.5" aria-hidden="true" />
              Committee workspace
            </div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
              Run every tournament stage with confidence
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-blue-50 sm:text-base">
              Review registrations and seeds, approve draws, schedule courts, and assign eligible officials from one operational view.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            {user?.roles.isPlatformAdmin && <Button
              nativeButton={false}
              render={<Link href="/admin/users" />}
              variant="outline"
              className="min-h-12 border-white/30 bg-white/10 text-white hover:bg-white/20 hover:text-white"
            >
              <UserCog className="size-4" aria-hidden="true" />
              Role approvals
            </Button>}
            <CreateTournamentDialog />
          </div>
        </div>
      </section>

      {(!tournamentsResult.success || !overviewResult.success) && (
        <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900" role="alert">
          <CircleAlert className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-semibold">Some committee data could not be loaded</p>
            <p className="mt-1">
              Refresh the page. If the problem continues, verify that the latest Supabase migration has been applied.
            </p>
          </div>
        </div>
      )}

      <section aria-labelledby="committee-summary-heading">
        <div className="mb-4 flex items-center justify-between gap-4">
          <div>
            <h2 id="committee-summary-heading" className="text-lg font-bold text-foreground">
              Today at a glance
            </h2>
            <p className="text-sm text-muted-foreground">Live operational counts across your tournaments</p>
          </div>
          <span className="hidden items-center gap-2 text-xs font-medium text-muted-foreground sm:inline-flex">
            <Activity className="size-4 text-emerald-600" aria-hidden="true" />
            Supabase connected
          </span>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {metrics.map((metric) => {
            const Icon = metric.icon
            return (
              <Card key={metric.label} className="border-slate-200 shadow-sm">
                <CardContent className="flex items-start gap-4 p-5">
                  <div className={`flex size-11 shrink-0 items-center justify-center rounded-xl ${metric.iconClass}`}>
                    <Icon className="size-5" aria-hidden="true" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-muted-foreground">{metric.label}</p>
                    <p className="mt-0.5 text-2xl font-bold tracking-tight text-foreground">{metric.value}</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">{metric.detail}</p>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="overflow-hidden border-slate-200 shadow-sm">
          <CardHeader className="border-b bg-slate-50/80">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="text-lg">Tournament portfolio</CardTitle>
                <CardDescription>Open any event to manage categories, rosters, draws, and schedules.</CardDescription>
              </div>
              <Badge variant="outline" className="w-fit bg-white">
                {tournaments.length} total
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {tournaments.length === 0 ? (
              <div className="flex flex-col items-center px-6 py-16 text-center">
                <div className="flex size-14 items-center justify-center rounded-2xl bg-blue-50 text-blue-700">
                  <Trophy className="size-7" aria-hidden="true" />
                </div>
                <h3 className="mt-4 text-base font-semibold">No tournaments yet</h3>
                <p className="mt-1 max-w-sm text-sm leading-6 text-muted-foreground">
                  Create a draft first. You can add independent categories and review every stage before publishing.
                </p>
                <div className="mt-5">
                  <CreateTournamentDialog />
                </div>
              </div>
            ) : (
              <>
                <div className="hidden overflow-x-auto md:block">
                  <Table>
                    <caption className="sr-only">Tournaments available to the committee</caption>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="pl-6">Tournament</TableHead>
                        <TableHead>Venue</TableHead>
                        <TableHead>Dates</TableHead>
                        <TableHead>Courts</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="pr-6 text-right">Workspace</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {tournaments.map((tournament) => (
                        <TableRow key={tournament.id} className="hover:bg-slate-50/80">
                          <TableCell className="pl-6">
                            <p className="font-semibold text-foreground">{tournament.title}</p>
                            <p className="mt-1 line-clamp-1 max-w-sm text-xs text-muted-foreground">
                              {tournament.description || "No event description"}
                            </p>
                          </TableCell>
                          <TableCell>
                            <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                              <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
                              {tournament.location}
                            </span>
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                            {formatDate(tournament.start_date)} – {formatDate(tournament.end_date)}
                          </TableCell>
                          <TableCell className="font-semibold">{tournament.court_count}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={statusClass(tournament.status)}>
                              {statusLabel(tournament.status)}
                            </Badge>
                          </TableCell>
                          <TableCell className="pr-6 text-right">
                            <Link
                              href={`/admin/tournaments/${tournament.id}`}
                              className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-primary transition hover:border-blue-300 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                            >
                              Manage
                              <ArrowRight className="size-4" aria-hidden="true" />
                            </Link>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                <div className="divide-y md:hidden">
                  {tournaments.map((tournament) => (
                    <Link
                      key={tournament.id}
                      href={`/admin/tournaments/${tournament.id}`}
                      className="block p-5 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold text-foreground">{tournament.title}</p>
                          <p className="mt-1 text-sm text-muted-foreground">{tournament.location}</p>
                        </div>
                        <Badge variant="outline" className={statusClass(tournament.status)}>
                          {statusLabel(tournament.status)}
                        </Badge>
                      </div>
                      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
                        <span>{formatDate(tournament.start_date)} – {formatDate(tournament.end_date)}</span>
                        <span>{tournament.court_count} courts</span>
                      </div>
                      <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-primary">
                        Manage tournament <ArrowRight className="size-4" aria-hidden="true" />
                      </span>
                    </Link>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card className="border-blue-200 bg-blue-50/60 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Settings2 className="size-5 text-blue-700" aria-hidden="true" />
                Recommended next action
              </CardTitle>
            </CardHeader>
            <CardContent>
              {overview.unscheduledMatchCount > 0 ? (
                <div>
                  <p className="font-semibold text-blue-950">Schedule {overview.unscheduledMatchCount} matches</p>
                  <p className="mt-1 text-sm leading-6 text-blue-900">
                    Open a tournament, select a published category, and assign courts and times. Conflict checks run before saving.
                  </p>
                </div>
              ) : overview.openCategoryCount > 0 ? (
                <div>
                  <p className="font-semibold text-blue-950">Monitor open registration</p>
                  <p className="mt-1 text-sm leading-6 text-blue-900">
                    Review confirmed and waitlisted players, verify seeds, and close registration when the roster is ready.
                  </p>
                </div>
              ) : (
                <div>
                  <p className="font-semibold text-blue-950">Prepare the next event</p>
                  <p className="mt-1 text-sm leading-6 text-blue-900">
                    Create a tournament draft or continue configuring categories for an existing event.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-slate-200 shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">Recent protected activity</CardTitle>
              <CardDescription>Latest auditable committee operations</CardDescription>
            </CardHeader>
            <CardContent>
              {activity.length === 0 ? (
                <p className="rounded-lg border border-dashed border-slate-200 p-4 text-sm text-muted-foreground">
                  No protected activity recorded yet.
                </p>
              ) : (
                <ol className="space-y-4">
                  {activity.map((item) => (
                    <li key={item.id} className="relative pl-5 before:absolute before:left-[5px] before:top-2 before:h-[calc(100%+0.5rem)] before:w-px before:bg-slate-200 last:before:hidden">
                      <span className="absolute left-0 top-1.5 size-2.5 rounded-full bg-blue-600 ring-4 ring-blue-50" aria-hidden="true" />
                      <p className="text-sm font-semibold text-foreground">{activityLabel(item.action)}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {formatDate(item.created_at)} · {item.entity_type.replaceAll("_", " ")}
                      </p>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
