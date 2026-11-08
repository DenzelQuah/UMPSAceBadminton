import type { Match } from "@/app/(dashboard)/tournaments/types"

export const TBA_MATCH_TIME = "TBA — to be announced"
const publishedStages=["DRAW_PUBLISHED","GROUP_STAGE_IN_PROGRESS","GROUP_STAGE_COMPLETED","KNOCKOUT_IN_PROGRESS"]

export function canEditMatchSchedule(match:Pick<Match,"status"|"category_status"|"tournament_status">) {
  return match.status==="SCHEDULED"
    && !["COMPLETED","ARCHIVED","CANCELLED"].includes(match.tournament_status ?? "")
    && (!match.category_status || publishedStages.includes(match.category_status))
}

export function matchScheduleHref(tournamentId:string,categoryId:string,matchId:string) {
  const query=new URLSearchParams({category:categoryId,schedule:matchId})
  return `/admin/tournaments/${encodeURIComponent(tournamentId)}?${query}#match-schedule`
}

/** datetime-local has no timezone. Both input and output explicitly use MYT. */
export function malaysiaDateTimeInput(value?:string | null) {
  if(!value || !Number.isFinite(Date.parse(value)))return ""
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Kuala_Lumpur",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date(value))
  const part=(type:Intl.DateTimeFormatPartTypes)=>parts.find((item)=>item.type===type)?.value ?? ""
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`
}

export function malaysiaDateTimeToIso(value:string):string | null {
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))return null
  const parsed=new Date(`${value}:00+08:00`)
  if(!Number.isFinite(parsed.getTime()) || malaysiaDateTimeInput(parsed.toISOString())!==value)return null
  return parsed.toISOString()
}
