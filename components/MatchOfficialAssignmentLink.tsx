import Link from "next/link"
import { UserCheck } from "lucide-react"

export default function MatchOfficialAssignmentLink({matchId,canAssign,status}:{matchId:string;canAssign:boolean;status:string}) {
  if(!canAssign || status!=="SCHEDULED")return null
  return <Link href={`/matches/${matchId}/officials`} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-primary hover:border-blue-300 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><UserCheck className="size-4 shrink-0" aria-hidden="true" />Assign officials</Link>
}
