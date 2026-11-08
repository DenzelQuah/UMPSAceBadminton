import Link from "next/link"
import { CalendarClock } from "lucide-react"
import type { Match } from "@/app/(dashboard)/tournaments/types"
import { canEditMatchSchedule,matchScheduleHref } from "@/lib/tournament/match-scheduling"

export default function MatchScheduleLink({match,tournamentId,canManage}:{match:Match;tournamentId?:string;canManage:boolean}) {
  if(!canManage || !tournamentId || !canEditMatchSchedule(match))return null
  return <Link href={matchScheduleHref(tournamentId,match.category_id,match.id)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 text-sm font-semibold text-primary hover:border-blue-400 hover:bg-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><CalendarClock className="size-4 shrink-0" aria-hidden="true" />{match.scheduled_time ? "Edit match time" : "Set match time"}</Link>
}
