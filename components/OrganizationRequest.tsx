"use client"

import { useState } from "react"
import { submitRoleRequest, type RoleRequest } from "@/app/actions/organization"
import { ROLE_DETAILS, ROLE_LABELS,canApplyForCommitteeRoles, type OrganizationalRole } from "@/lib/auth/organizational-roles"
import { Button } from "@/components/ui/button"

export default function OrganizationRequest({ currentRole, detail, requests, loadError }: { currentRole: OrganizationalRole; detail: string; requests: RoleRequest[]; loadError?: string }) {
  const [role, setRole] = useState<"MT" | "EXCO" | "AJK">("EXCO")
  const [position, setPosition] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")
  const pending = requests.find((request) => request.status === "PENDING")
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("")
    try {
      const result = await submitRoleRequest(role, position)
      if (!result.success) { setError(result.error.message); return }
      setMessage("Your request is pending administrator approval. Your current access is unchanged until approval.")
    } catch { setError("Your request could not be submitted. Try again.") }
    finally { setBusy(false) }
  }
  if(!canApplyForCommitteeRoles({organizational_role:currentRole}))return null
  return <section className="rounded-2xl border bg-white p-5" aria-labelledby="organization-access-heading">
    <h2 id="organization-access-heading" className="font-bold text-primary">Organization access</h2>
    <p className="mt-2 text-sm">Approved role: <strong>{ROLE_LABELS[currentRole]}</strong>{detail ? ` · ${detail}` : ""}</p>
    {pending && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-950">Pending: {pending.requested_role} · {pending.role_detail}. An administrator must approve this request.</p>}
    {!pending && requests[0]?.status === "REJECTED" && <p className="mt-3 text-sm text-slate-700">Your previous request was declined. {requests[0].review_note}</p>}
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    {loadError && <p role="alert" className="mt-3 text-sm text-amber-900">{loadError}</p>}
    {message && <p role="status" className="mt-3 text-sm text-emerald-800">{message}</p>}
    <details className="mt-3"><summary className="min-h-12 cursor-pointer py-3 text-sm font-semibold">{pending ? "Update pending request" : "Request MT, EXCO or AJK access"}</summary>
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm font-semibold">Requested role<select value={role} onChange={(event) => { setRole(event.target.value as typeof role); setPosition("") }} className="mt-1 min-h-12 w-full rounded-lg border bg-white px-3">{(["MT", "EXCO", "AJK"] as const).map((item) => <option key={item} value={item}>{ROLE_LABELS[item]}</option>)}</select></label>
        <label className="text-sm font-semibold">Position / team<select required value={position} onChange={(event) => setPosition(event.target.value)} className="mt-1 min-h-12 w-full rounded-lg border bg-white px-3"><option value="">Choose a position or team</option>{ROLE_DETAILS[role].map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
        <Button type="submit" disabled={busy || !position} className="min-h-12 self-end">{busy ? "Submitting…" : "Request approval"}</Button>
      </form>
      <p className="mt-3 text-xs text-muted-foreground">Approved MT members manage tournaments. Approved EXCO/AJK members receive match duties from MT. Everyone can still participate as a player.</p>
    </details>
  </section>
}
