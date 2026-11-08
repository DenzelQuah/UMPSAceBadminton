"use client"

import { memo,useCallback,useEffect,useMemo,useRef } from "react"
import { useRouter } from "next/navigation"
import type { Match,Category } from "@/app/(dashboard)/tournaments/types"
import type { PublishedGroup } from "@/app/actions/live-scores"
import type { KnockoutPreview } from "@/app/actions/knockout"
import type { LiveScore,LiveScores } from "@/lib/realtime/live-scores"
import { useLiveScores } from "@/lib/realtime/use-live-scores"
import MatchScoreLine from "@/components/MatchScoreLine"
import KnockoutBracket from "@/components/KnockoutBracket"
import MatchOfficialAssignmentLink from "@/components/MatchOfficialAssignmentLink"
import MatchScheduleLink from "@/components/MatchScheduleLink"
import { playerMatchTime } from "@/lib/tournament/player-schedule"

const Fixture=memo(function Fixture({match,score,canAssignOfficials,managementTournamentId}:{match:Match;score?:LiveScore;canAssignOfficials:boolean;managementTournamentId?:string}){
  return <div className="space-y-3 rounded-xl border bg-white p-4"><div className="flex flex-wrap justify-between gap-2"><p className="text-xs text-muted-foreground">{match.group_round ? `Round ${match.group_round} · ` : ""}{match.court_number ? `Court ${match.court_number}` : "Court pending"}</p><p className={`text-xs font-semibold ${score?.status==="IN_PROGRESS" ? "text-emerald-700":"text-slate-500"}`}>{(score?.status ?? match.status).replaceAll("_"," ")}</p></div><p className="text-sm font-semibold">{match.player_a_name ?? "Player A"} <span className="font-normal text-muted-foreground">vs</span> {match.player_b_name ?? "Player B"}</p><p className="text-xs text-muted-foreground">Time: {playerMatchTime(match)}</p><MatchScoreLine score={score} /><div className="flex flex-wrap gap-2"><MatchScheduleLink match={{...match,status:score?.status ?? match.status}} tournamentId={managementTournamentId} canManage={!!managementTournamentId} /><MatchOfficialAssignmentLink matchId={match.id} canAssign={canAssignOfficials} status={score?.status ?? match.status} /></div></div>
})

type GroupProps={group:PublishedGroup;matches:Match[];scores:LiveScores;canAssignOfficials:boolean;managementTournamentId?:string}
const Group=memo(function Group({group,matches,scores,canAssignOfficials,managementTournamentId}:GroupProps){
  return <div className="space-y-3"><h3 className="font-bold text-primary">{group.name} <span className="text-xs font-normal text-muted-foreground">({group.players.length} entries)</span></h3><p className="text-xs text-muted-foreground">{group.players.map((p)=>p.name).join(" · ")}</p><div className="grid gap-3 md:grid-cols-2">{matches.map((match)=><Fixture key={match.id} match={match} score={scores[match.id]} canAssignOfficials={canAssignOfficials} managementTournamentId={managementTournamentId} />)}</div></div>
},(before,after)=>before.managementTournamentId===after.managementTournamentId && before.canAssignOfficials===after.canAssignOfficials && before.group===after.group && before.matches===after.matches && after.matches.every((match)=>before.scores[match.id]===after.scores[match.id]))

export default function LiveCategoryPreview({category,groups,matches,preview,initialScores,error,canAssignOfficials=false,managementTournamentId}:{category:Category;groups:PublishedGroup[];matches:Match[];preview:KnockoutPreview | null;initialScores:LiveScore[];error?:string;canAssignOfficials?:boolean;managementTournamentId?:string}) {
  const router=useRouter(),refreshTimer=useRef<ReturnType<typeof setTimeout> | null>(null)
  const refreshDraw=useCallback(()=>{
    if(refreshTimer.current)return
    refreshTimer.current=setTimeout(()=>{refreshTimer.current=null;router.refresh()},500)
  },[router])
  useEffect(()=>()=>{if(refreshTimer.current)clearTimeout(refreshTimer.current)},[])
  const live=useLiveScores(category.id,initialScores,undefined,refreshDraw)
  const groupMatches=useMemo(()=>{
    const result=new Map<string,Match[]>()
    for(const match of matches)if(match.group_id){const group=result.get(match.group_id) ?? [];group.push(match);result.set(match.group_id,group)}
    return result
  },[matches])
  return <section className="space-y-4 rounded-2xl border bg-white p-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-bold">{groups.length ? "Group Preview":"Draw Preview"} · {category.name}</h2><span role="status" className={`rounded-full px-3 py-1 text-xs font-semibold ${live.connection==="connected" ? "bg-emerald-50 text-emerald-800":"bg-amber-50 text-amber-900"}`}>{live.connection==="connected" ? "Live scores" : live.connection==="setup_required" ? "Live scoring setup required":"Reconnecting…"}</span></div>
    {error && <p role="alert" className="text-sm text-amber-900">{error}</p>}
    {groups.map((group)=><Group key={group.id} group={group} matches={groupMatches.get(group.id) ?? []} scores={live.scores} canAssignOfficials={canAssignOfficials} managementTournamentId={managementTournamentId} />)}
    {preview?.status==="PUBLISHED" && <KnockoutBracket bracket={preview.bracket} matches={matches.filter((m)=>m.knockout_round!==null)} scores={live.scores} canAssignOfficials={canAssignOfficials} managementTournamentId={managementTournamentId} />}
    {!groups.length && !preview && <p className="text-sm text-muted-foreground">The published draw will appear here when it is ready.</p>}
  </section>
}
