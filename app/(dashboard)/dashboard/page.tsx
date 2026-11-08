import Link from "next/link"
import { redirect } from "next/navigation"
import { ArrowRight, ShieldCheck, Trophy, UserCheck } from "lucide-react"
import { getCurrentUserWithRoles } from "@/app/actions/user"
import ImmersiveAccess from "@/components/ImmersiveAccess"
import { CreateTournamentDialog } from "../admin/CreateTournamentDialog"
import OrganizationRequest from "@/components/OrganizationRequest"
import AutoRefresh from "@/components/AutoRefresh"
import { getMyRoleRequests } from "@/app/actions/organization"
import { getMyAjkApplications } from "@/app/actions/tournament-roles"
import { getVisibleTournaments } from "@/app/actions/tournaments"
import TournamentAjkApplication from "@/components/TournamentAjkApplication"
import { displayName,canApplyForCommitteeRoles } from "@/lib/auth/organizational-roles"

const tournamentFlow = ["Event setup", "Registration & committee", "Seeds & draw", "Courts & officials", "Live scoring", "Results & completion"]
const mtShortcuts = [
  { href: "/mt", title: "MT Dashboard", description: "Review tournament AJK applications and prepare your committee.", icon: ShieldCheck },
  { href: "/umpire", title: "Scoring & match duties", description: "Open match consoles and follow the action on court.", icon: UserCheck },
  { href: "/rankings", title: "Results & standings", description: "Check published tournament points and player rankings.", icon: Trophy },
]

export default async function DashboardPage() {
  const user = await getCurrentUserWithRoles()
  if (!user) redirect("/login")
  if (!user.profile) return <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-6"><h1 className="text-xl font-bold">Your profile needs attention</h1><p className="mt-2">Your account is signed in, but your profile could not be loaded. Refresh this page or ask an administrator to check your account.</p></div>
  const canApply=canApplyForCommitteeRoles(user.profile)
  const organizerAccess = user.roles.isOrganizer
    ? { href: "/mt", label: "Access Dashboard", caption: "MT & organizers", description: "From the first draw to the final point. Manage tournaments, review AJK applications, and assign match duties." }
    : user.roles.isOfficial
      ? { href: "/umpire", label: "View Committee Duties", caption: "Your approved committee access", description: "Be part of every great match. View your assigned duties and support the action on court." }
      : { href: "#organization-access-heading", label: "Request Organizer Access", caption: "Join the organizing team", description: "Help bring the next tournament to life. Request a committee role below; access begins after administrator approval." }
  const [requests,applications,tournaments] = await Promise.all([
    canApply ? getMyRoleRequests() : null,canApply ? getMyAjkApplications() : null,canApply ? getVisibleTournaments() : null,
  ])
  return (
    <div className="mx-auto max-w-5xl space-y-7">
      <AutoRefresh intervalMs={10000} />
      <header className="py-2 sm:py-4">
        <p className="text-xs font-semibold uppercase tracking-[.2em] text-muted-foreground">{user.roles.isOrganizer ? "Tournament operations" : "On court. In the community."}</p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-primary sm:text-4xl">Welcome, {displayName(user.profile.full_name.split(" ")[0],user.profile.user_role)}</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">{user.roles.isOrganizer ? "Manage your tournaments from the first registration to the final result." : "Your next game starts here. Play, connect, or bring it all together."}</p>
      </header>
      {user.roles.isOrganizer && (
        <section aria-labelledby="tournament-actions-heading" className="space-y-5 rounded-2xl border border-blue-200 bg-white p-5 sm:p-6">
          <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
            <div>
              <h2 id="tournament-actions-heading" className="text-xl font-bold text-primary">Manage your tournaments</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">Create an event or open a tournament to manage its categories, entries, draw and schedule.</p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-3">
              <CreateTournamentDialog />
              <Link href="/admin" className="inline-flex min-h-12 items-center gap-2 rounded-lg border px-4 text-sm font-semibold text-primary hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Tournament management <ArrowRight className="size-4" aria-hidden="true" /></Link>
            </div>
          </div>
          <div className="border-t pt-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Tournament flow</p>
            <ol className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Tournament management stages in order">
              {tournamentFlow.map((stage,index)=><li key={stage} className="flex items-center gap-3 text-sm font-medium text-slate-700"><span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-blue-50 text-xs font-bold text-primary" aria-hidden="true">{index+1}</span>{stage}</li>)}
            </ol>
          </div>
          <nav aria-label="MT operational shortcuts" className="grid gap-3 border-t pt-5 lg:grid-cols-3">
            {mtShortcuts.map(({href,title,description,icon:Icon})=><Link key={href} href={href} className="group rounded-xl border p-4 hover:border-blue-300 hover:bg-blue-50/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><div className="flex items-center gap-2 text-sm font-bold text-primary"><Icon className="size-4 shrink-0" aria-hidden="true" /><span>{title}</span><ArrowRight className="ml-auto size-4 shrink-0" aria-hidden="true" /></div><p className="mt-2 text-xs leading-5 text-muted-foreground">{description}</p></Link>)}
          </nav>
        </section>
      )}
      {canApply && <TournamentAjkApplication tournaments={tournaments?.success ? tournaments.data.filter((t) => t.status !== "DRAFT") : []} applications={applications?.success ? applications.data : []} approvedTournamentIds={user.profile.tournament_ajk_ids} globalAjk={user.profile.organizational_role === "AJK"} loadError={applications && !applications.success ? applications.error.message : tournaments && !tournaments.success ? tournaments.error.message : undefined} />}
      {user.roles.isPlatformAdmin ? <Link href="/admin/users" className="inline-flex min-h-12 items-center rounded-lg border bg-white px-4 text-sm font-bold text-primary">Review organization appointments</Link> : canApply && <OrganizationRequest currentRole={user.profile.organizational_role} detail={user.profile.organizational_role_detail} requests={requests?.success ? requests.data : []} loadError={requests && !requests.success ? requests.error.message : undefined} />}
      <p className="text-sm text-muted-foreground">MT reviews tournament AJK applications and assigns match duties. System Admins provide backup approval access and approve organization-wide appointments.</p>
      <section aria-labelledby="community-workspaces-heading" className="space-y-4 border-t pt-7">
        <div><h2 id="community-workspaces-heading" className="text-lg font-bold text-primary">Community & other workspaces</h2><p className="mt-2 text-sm text-muted-foreground">Explore tournaments as a player or switch to your approved workspace.</p></div>
        <ImmersiveAccess organizer={organizerAccess} />
      </section>
    </div>
  )
}
