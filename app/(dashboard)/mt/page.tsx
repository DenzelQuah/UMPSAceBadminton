import Link from "next/link"
import { redirect } from "next/navigation"
import { getCurrentUserWithRoles } from "@/app/actions/user"
import { getPendingAjkApplications } from "@/app/actions/tournament-roles"
import { getAdminTournaments } from "@/app/actions/tournaments"
import AutoRefresh from "@/components/AutoRefresh"
import PendingAjkTable from "@/components/PendingAjkTable"
import { CreateTournamentDialog } from "../admin/CreateTournamentDialog"
import { categoryStatusLabel } from "@/lib/tournament/lifecycle"

export default async function MtDashboard() {
  const user = await getCurrentUserWithRoles()
  if (!user) redirect("/login")
  if (!user.roles.isOrganizer) redirect("/dashboard?error=unauthorized_admin")
  const [applications,tournaments] = await Promise.all([getPendingAjkApplications(),getAdminTournaments()])
  return <div className="mx-auto max-w-6xl space-y-6">
    <AutoRefresh intervalMs={10000} />
    <Link href="/admin" className="inline-flex min-h-12 items-center rounded-lg border bg-white px-4 text-sm font-semibold text-primary">Open tournament management</Link>
    <section className="flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-primary p-6 text-white"><div><h1 className="text-3xl font-bold">MT Dashboard</h1><p className="mt-2 text-sm text-blue-50">Approve tournament AJK applications and manage your tournaments.</p>{user.roles.isPlatformAdmin && <p className="mt-2 text-xs text-blue-100">System Admin access · You can review requests when no MT is available.</p>}</div><CreateTournamentDialog /></section>
    <section className="rounded-2xl border bg-white p-5"><h2 className="text-lg font-bold text-primary">Pending AJK{applications.success ? ` (${applications.data.length})` : ""}</h2><p className="mb-4 mt-2 text-sm text-muted-foreground">Approval grants committee access for the named tournament. Assign umpire and linesman duties from its management page.</p>
      {applications.success ? <PendingAjkTable applications={applications.data} currentUserId={user.user.id} /> : <p role="alert" className="rounded-lg bg-amber-50 p-4 text-sm text-amber-950">{applications.error.message}{applications.error.code === "DATABASE_SETUP_REQUIRED" && " Run the tournament AJK applications migration after the organizational-role migration."}</p>}
    </section>
    <section className="rounded-2xl border bg-white p-5"><h2 className="text-lg font-bold text-primary">Tournaments</h2>{!tournaments.success ? <p role="alert" className="mt-3 text-sm text-red-800">{tournaments.error.message}</p> : tournaments.data.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">Create your first tournament to get started.</p> : <ul className="mt-3 divide-y">{tournaments.data.map((tournament) => <li key={tournament.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div><p className="font-semibold">{tournament.title}</p><p className="mt-1 text-xs text-muted-foreground">{categoryStatusLabel(tournament.status)}</p></div><Link href={`/admin/tournaments/${tournament.id}`} className="inline-flex min-h-12 items-center rounded-lg border px-4 text-sm font-semibold text-primary">Manage tournament</Link></li>)}</ul>}</section>
  </div>
}
