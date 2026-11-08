"use client"

import { useState,useTransition } from "react"
import { RefreshCw,Save,UserCheck } from "lucide-react"
import { assignOfficial,getMatchOfficialAvailability,type MatchOfficialAssignment } from "@/app/actions/officials"
import { Button } from "@/components/ui/button"
import { toast } from "@/components/ui/toast"

export function OfficialSelector({initialData}:{initialData:MatchOfficialAssignment}) {
  const [data,setData]=useState(initialData)
  const [umpireId,setUmpireId]=useState(initialData.match.umpire_id ?? "")
  const [linesmanId,setLinesmanId]=useState(initialData.match.linesman_id ?? "")
  const [error,setError]=useState("")
  const [stale,setStale]=useState(false)
  const [busy,startTransition]=useTransition()
  const fixture=data.match
  const dirty=umpireId!==(fixture.umpire_id ?? "") || linesmanId!==(fixture.linesman_id ?? "")
  const availableCount=data.officials.filter((person)=>person.available).length
  const invalidSelection=[umpireId,linesmanId].some((id)=>id && !data.officials.some((person)=>person.id===id && person.available))
  const duplicate=!!umpireId && umpireId===linesmanId

  async function refreshAvailability(reset=false) {
    const result=await getMatchOfficialAvailability(fixture.id)
    if(!result.success){setError(result.error.message);setStale(true);return false}
    setData(result.data);setStale(false)
    if(reset){setUmpireId(result.data.match.umpire_id ?? "");setLinesmanId(result.data.match.linesman_id ?? "")}
    return true
  }

  function refresh() {
    startTransition(async()=>{
      setError("")
      try {await refreshAvailability()}
      catch {setStale(true);setError("Availability could not be refreshed. Check your connection and try again.")}
    })
  }

  function save() {
    startTransition(async()=>{
      setError("")
      try {
        const result=await assignOfficial({matchId:fixture.id,umpireId:umpireId || null,linesmanId:linesmanId || null})
        if(!result.success){setError(result.error.message);await refreshAvailability();return}
        setData((current)=>({...current,match:{...current.match,umpire_id:umpireId || null,linesman_id:linesmanId || null}}))
        toast.add({title:"Officials assigned",description:"The match duties are saved. Assigned umpires can open their scoring console.",type:"success"})
        await refreshAvailability(true)
      } catch {setStale(true);setError("The request could not be confirmed. Refresh availability before trying again.")}
    })
  }

  function options(otherSlot:string,selected:string,currentId:string | null,currentName:string | null) {
    return <>
      <option value="">Unassigned</option>
      {currentId && !data.officials.some((person)=>person.id===currentId) && <option value={currentId} disabled>{currentName ?? "Previous official"} — no longer eligible</option>}
      {data.officials.map((person)=>{
        const inOtherSlot=person.id===otherSlot
        const reason=inOtherSlot ? "Selected for the other duty" : person.unavailable_reason
        return <option key={person.id} value={person.id} disabled={!person.available || inOtherSlot}>
          {person.full_name} · {person.organizational_role}{reason ? ` — ${reason}` : " — Available"}
        </option>
      })}
      {selected && selected!==currentId && !data.officials.some((person)=>person.id===selected) && <option value={selected} disabled>Selection no longer eligible</option>}
    </>
  }

  const selectClass="mt-2 min-h-12 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:bg-slate-100"
  return <section aria-labelledby="assignment-heading" className="space-y-5 rounded-2xl border bg-white p-5 sm:p-7">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 id="assignment-heading" className="flex items-center gap-2 text-xl font-bold text-primary"><UserCheck className="size-5" aria-hidden="true" />Match Official Assignment</h2><p className="mt-2 text-sm text-muted-foreground">{availableCount} available of {data.officials.length} approved members. Conflicts include other tournaments.</p></div>
      <Button variant="outline" className="min-h-12" onClick={refresh} disabled={busy}><RefreshCw className="size-4" aria-hidden="true" />{busy ? "Checking…" : "Refresh availability"}</Button>
    </div>
    {fixture.locked && <p role="status" className="rounded-xl bg-slate-100 p-4 text-sm">Assignments are locked because the match has started or the tournament is closed.</p>}
    {!fixture.scheduled_time && <p role="status" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-950">This match has no start time yet. Assignments are provisional; availability will be checked again when MT schedules the match.</p>}
    {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">{error}</p>}
    {!data.officials.length && <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">No approved officials are available for this tournament. A System Admin can approve committee members, or MT can approve tournament AJK applications.</p>}
    <fieldset disabled={busy || fixture.locked || stale} className="grid min-w-0 gap-5 sm:grid-cols-2">
      <legend className="sr-only">Assign match duties</legend>
      <label className="min-w-0 text-sm font-semibold" htmlFor="assignment-umpire">Umpire<select id="assignment-umpire" value={umpireId} onChange={(event)=>setUmpireId(event.target.value)} className={selectClass}>{options(linesmanId,umpireId,fixture.umpire_id,fixture.umpire_name)}</select><span className="mt-2 block text-xs font-normal text-muted-foreground">Operates scoring for this match.</span></label>
      <label className="min-w-0 text-sm font-semibold" htmlFor="assignment-linesman">Linesman<select id="assignment-linesman" value={linesmanId} onChange={(event)=>setLinesmanId(event.target.value)} className={selectClass}>{options(umpireId,linesmanId,fixture.linesman_id,fixture.linesman_name)}</select><span className="mt-2 block text-xs font-normal text-muted-foreground">Receives the match duty with read-only scoring access.</span></label>
    </fieldset>
    {invalidSelection && <p role="status" className="text-sm text-amber-900">A selected official is unavailable or no longer eligible. Choose another member or clear the slot.</p>}
    {duplicate && <p role="status" className="text-sm text-amber-900">Choose different people for umpire and linesman.</p>}
    <div className="flex flex-wrap items-center gap-3 border-t pt-5">
      <Button onClick={save} disabled={busy || fixture.locked || stale || !dirty || invalidSelection || duplicate} className="min-h-12"><Save className="size-4" aria-hidden="true" />{busy ? "Checking…" : "Save officials"}</Button>
      {dirty && <Button variant="outline" className="min-h-12" disabled={busy} onClick={()=>{setUmpireId(fixture.umpire_id ?? "");setLinesmanId(fixture.linesman_id ?? "");setError("")}}>Reset selection</Button>}
      <p className="text-xs leading-5 text-muted-foreground">40-minute match slots · 70-minute start-time buffer for players. Availability is rechecked when saving.</p>
    </div>
  </section>
}
