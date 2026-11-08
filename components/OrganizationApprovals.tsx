"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { reviewRoleRequest, revokeOrganizationRole, type RoleRequest, type OrganizationMember } from "@/app/actions/organization"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ROLE_LABELS } from "@/lib/auth/organizational-roles"

export default function OrganizationApprovals({ requests, members }: { requests: RoleRequest[]; members: OrganizationMember[] }) {
  const router = useRouter()
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const pending = requests.filter((request) => request.status === "PENDING")
  async function decide(request: RoleRequest, approve: boolean) {
    setBusy(true); setError(""); setMessage("")
    try {
      const result = await reviewRoleRequest(request.id, approve, notes[request.id] ?? "")
      if (!result.success) { setError(result.error.message); return }
      setMessage(`${request.full_name}'s request was ${approve ? "approved" : "declined"}.`); router.refresh()
    } catch { setError("The approval could not be saved. Try again.") }
    finally { setBusy(false) }
  }
  async function revoke(member: OrganizationMember) {
    setBusy(true); setError(""); setMessage("")
    try {
      const result = await revokeOrganizationRole(member.id, notes[member.id] ?? "")
      if (!result.success) { setError(result.error.message); return }
      setMessage(`${member.full_name}'s organization access was revoked.`); router.refresh()
    } catch { setError("Access could not be revoked. Try again.") }
    finally { setBusy(false) }
  }
  return <div className="space-y-6">
    {error && <p role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-900">{error}</p>}
    {message && <p role="status" className="rounded-lg bg-emerald-50 p-4 text-sm text-emerald-900">{message}</p>}
    <section className="rounded-2xl border bg-white p-5"><h2 className="text-lg font-bold text-primary">Pending approvals · {pending.length}</h2><p className="mt-2 text-sm text-muted-foreground">Approving MT grants tournament management. EXCO/AJK approval grants eligibility for match assignments.</p>
      {pending.length === 0 && <p className="mt-4 text-sm">No requests are waiting for approval.</p>}
      <div className="mt-4 space-y-4">{pending.map((request) => <div key={request.id} className="rounded-xl border p-4"><p className="font-semibold">{request.full_name}</p><p className="text-xs text-muted-foreground">{request.email}</p><p className="mt-2 text-sm font-semibold">{request.requested_role} · {request.role_detail}</p><label className="mt-3 block text-xs font-semibold">Review note (optional)<Input value={notes[request.id] ?? ""} onChange={(event) => setNotes({ ...notes, [request.id]: event.target.value })} className="mt-1 min-h-12" maxLength={500} /></label><div className="mt-3 flex flex-wrap gap-2"><Button className="min-h-12" disabled={busy} onClick={() => void decide(request, true)}>Approve {request.requested_role}</Button><Button className="min-h-12" variant="outline" disabled={busy} onClick={() => void decide(request, false)}>Decline</Button></div></div>)}</div>
    </section>
    <section className="rounded-2xl border bg-white p-5"><h2 className="text-lg font-bold text-primary">Approved organization members</h2><div className="mt-4 space-y-3">{members.filter((member) => member.is_admin || member.organizational_role !== "PLAYER").map((member) => <details key={member.id} className="rounded-xl border p-4"><summary className="min-h-12 cursor-pointer text-sm"><strong>{member.full_name}</strong> · {member.is_admin ? "Platform administrator" : ROLE_LABELS[member.organizational_role]}{member.organizational_role_detail ? ` · ${member.organizational_role_detail}` : ""}</summary>{!member.is_admin && <div className="mt-2"><label className="text-xs font-semibold">Reason for revoking access (at least 10 characters)<Input className="mt-1 min-h-12" value={notes[member.id] ?? ""} onChange={(event) => setNotes({ ...notes, [member.id]: event.target.value })} maxLength={500} /></label><Button variant="destructive" className="mt-3 min-h-12" disabled={busy || (notes[member.id] ?? "").trim().length < 10} onClick={() => void revoke(member)}>Revoke organizational access</Button></div>}</details>)}</div></section>
  </div>
}
