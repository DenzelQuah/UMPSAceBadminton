import Link from "next/link"
import { notFound,redirect } from "next/navigation"
import { ArrowLeft,CalendarClock,MapPin } from "lucide-react"
import { getCurrentUserWithRoles } from "@/app/actions/user"
import { getMatchOfficialAvailability } from "@/app/actions/officials"
import { canAssignMatchOfficials } from "@/lib/auth/organizational-roles"
import { OfficialSelector } from "@/components/OfficialSelector"

export default async function MatchOfficialsPage({params}:{params:Promise<{matchId:string}>}) {
  const user=await getCurrentUserWithRoles()
  if(!user)redirect("/login")
  if(!canAssignMatchOfficials(user.profile))redirect("/dashboard?error=unauthorized_official_assignment")
  const {matchId}=await params
  const result=await getMatchOfficialAvailability(matchId)
  if(!result.success){
    if(["NOT_FOUND","VALIDATION_ERROR"].includes(result.error.code))notFound()
    return <div role="alert" className="mx-auto max-w-4xl rounded-2xl border border-amber-200 bg-amber-50 p-6"><h1 className="text-xl font-bold">Match official assignment unavailable</h1><p className="mt-3 text-sm">{result.error.message}</p><Link href="/tournaments" className="mt-4 inline-flex min-h-12 items-center font-semibold text-primary underline">Back to tournaments</Link></div>
  }
  const {match}=result.data
  const time=match.scheduled_time ? new Intl.DateTimeFormat("en-MY",{timeZone:"Asia/Kuala_Lumpur",dateStyle:"medium",timeStyle:"short"}).format(new Date(match.scheduled_time))+" MYT" : "Time to be scheduled"
  return <div className="mx-auto max-w-4xl space-y-6">
    <Link href={`/tournaments/${match.tournament_id}`} className="inline-flex min-h-12 items-center gap-2 rounded-lg text-sm font-semibold text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><ArrowLeft className="size-4" aria-hidden="true" />Back to tournament</Link>
    <header className="rounded-2xl bg-primary p-6 text-primary-foreground sm:p-8"><p className="text-sm text-blue-100">{match.tournament_title} · {match.category_name}</p><h1 className="mt-3 text-2xl font-bold sm:text-3xl">{match.player_a_name} <span className="font-normal text-blue-200">vs</span> {match.player_b_name}</h1><div className="mt-4 flex flex-wrap gap-4 text-sm text-blue-50"><span className="inline-flex items-center gap-2"><CalendarClock className="size-4" aria-hidden="true" />{time}</span><span className="inline-flex items-center gap-2"><MapPin className="size-4" aria-hidden="true" />{match.court_number ? `Court ${match.court_number}` : "Court to be assigned"}</span><span>{match.status.replaceAll("_"," ")}</span></div></header>
    <OfficialSelector key={match.id} initialData={result.data} />
  </div>
}
