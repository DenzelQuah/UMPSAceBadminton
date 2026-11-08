"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { applyForTournamentAjk, type AjkApplication } from "@/app/actions/tournament-roles"
import { Button } from "@/components/ui/button"

type Event = { id:string; title:string; status:string }
export default function TournamentAjkApplication({ tournaments, applications, approvedTournamentIds = [], globalAjk = false, loadError }: {
  tournaments:Event[]; applications:AjkApplication[]; approvedTournamentIds?:string[]; globalAjk?:boolean; loadError?:string;
}) {
  const router = useRouter()
  const [selected, setSelected] = useState(tournaments.length === 1 ? tournaments[0].id : "")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const event = tournaments.find((item) => item.id === selected)
  const latest = applications.find((item) => item.tournament_id === selected)
  const approved = globalAjk || approvedTournamentIds.includes(selected) || latest?.status === "APPROVED"
  const pending = latest?.status === "PENDING"
  const closed = !event || ["DRAFT","COMPLETED","ARCHIVED","CANCELLED"].includes(event.status)
  async function apply(e:React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(""); setMessage("")
    try {
      const result = await applyForTournamentAjk(selected)
      if (!result.success) { setError(result.error.message); return }
      setMessage(result.data.status === "APPROVED" ? "Your AJK appointment is approved." : "Application submitted. An MT member or System Admin will review it.")
      router.refresh()
    } catch { setError("The application could not be submitted. Try again.") }
    finally { setBusy(false) }
  }
  return <section className="rounded-2xl border bg-white p-5" aria-labelledby="tournament-ajk-heading">
    <h2 id="tournament-ajk-heading" className="text-lg font-bold text-primary">Join a tournament committee</h2>
    <p className="mt-2 text-sm text-muted-foreground">Apply as an AJK for a specific tournament. You can still compete as a player; match duties are assigned separately by MT.</p>
    <form onSubmit={apply} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
      <label className="flex-1 text-sm font-semibold">Tournament<select value={selected} onChange={(e) => { setSelected(e.target.value); setError(""); setMessage("") }} className="mt-1 min-h-12 w-full rounded-lg border bg-white px-3" required><option value="">Choose a tournament</option>{tournaments.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
      <Button type="submit" disabled={busy || !!loadError || approved || pending || closed} className="min-h-12">{busy ? "Submitting…" : approved ? "Approved AJK" : pending ? "Pending approval" : "Apply as AJK"}</Button>
    </form>
    {approved && selected && <p className="mt-3 text-sm text-emerald-800">You have approved AJK access for this tournament.</p>}
    {pending && !approved && <p className="mt-3 text-sm text-amber-900">Your application is pending MT approval.</p>}
    {latest?.status === "REJECTED" && !approved && <p className="mt-3 text-sm">Your previous application was rejected. You can apply again while applications are open.</p>}
    {selected && closed && !approved && <p className="mt-3 text-sm">This tournament is not accepting AJK applications.</p>}
    {tournaments.length === 0 && <p className="mt-3 text-sm">Applications become available when a tournament is published.</p>}
    {(error || loadError) && <p role="alert" className="mt-3 text-sm text-red-800">{error || loadError}</p>}
    {message && <p role="status" className="mt-3 text-sm text-emerald-800">{message}</p>}
  </section>
}
