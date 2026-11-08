"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { reviewTournamentAjk, type PendingAjk } from "@/app/actions/tournament-roles"
import { Button } from "@/components/ui/button"
import { Table,TableBody,TableCell,TableHead,TableHeader,TableRow } from "@/components/ui/table"

export default function PendingAjkTable({ applications, currentUserId }: { applications:PendingAjk[]; currentUserId:string }) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  async function decide(application:PendingAjk, approve:boolean) {
    setBusy(application.id); setError(""); setMessage("")
    try {
      const result = await reviewTournamentAjk(application.id,approve)
      if (!result.success) { setError(result.error.message); router.refresh(); return }
      setMessage(`${application.full_name}'s AJK application was ${approve ? "approved" : "rejected"}.`)
      router.refresh()
    } catch { setError("The decision could not be saved. Refresh and try again.") }
    finally { setBusy(null) }
  }
  return <div className="space-y-3">
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-900">{error}</p>}
    {message && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">{message}</p>}
    <Table><caption className="sr-only">Pending AJK applications by tournament</caption><TableHeader><TableRow><TableHead>Player</TableHead><TableHead>Tournament</TableHead><TableHead>Applied</TableHead><TableHead>Decision</TableHead></TableRow></TableHeader>
      <TableBody>{applications.length === 0 ? <TableRow><TableCell colSpan={4} className="py-8 text-center text-muted-foreground">No pending AJK requests.</TableCell></TableRow> : applications.map((application) => <TableRow key={application.id}>
        <TableCell><p className="font-semibold">{application.full_name}</p><p className="text-xs text-muted-foreground">{application.email}</p></TableCell>
        <TableCell>{application.tournament_title}</TableCell><TableCell className="whitespace-nowrap">{new Intl.DateTimeFormat("en-MY",{ dateStyle:"medium", timeZone:"Asia/Kuala_Lumpur" }).format(new Date(application.created_at))}</TableCell>
        <TableCell>{application.user_id === currentUserId ? <span className="text-xs text-muted-foreground">Another MT or System Admin must review your request.</span> : <div className="flex gap-2"><Button disabled={busy !== null} onClick={() => void decide(application,true)} className="min-h-12" aria-label={`Approve ${application.full_name} for ${application.tournament_title}`}>Approve</Button><Button disabled={busy !== null} variant="outline" onClick={() => void decide(application,false)} className="min-h-12" aria-label={`Reject ${application.full_name} for ${application.tournament_title}`}>Reject</Button></div>}</TableCell>
      </TableRow>)}</TableBody>
    </Table>
  </div>
}
