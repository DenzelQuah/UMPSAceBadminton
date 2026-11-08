"use client"

import { useCallback, useEffect, useState } from "react"
import { getPairState, inviteDoublesPartner, respondDoublesInvitation, type PairState } from "@/app/actions/doubles"
import { withdrawRegistration } from "@/app/actions/registrations"
import type { ApiResponse } from "@/lib/apiResponse"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export default function DoublesRegistration({ categoryId, isOpen }: { categoryId: string; isOpen: boolean }) {
  const [state, setState] = useState<PairState | null>(null)
  const [email, setEmail] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const reload = useCallback(async () => {
    try {
      const result = await getPairState(categoryId)
      if (result.success) setState(result.data)
      else setError(result.error.message)
    } catch { setError("Your pair information could not be loaded. Try again.") }
  }, [categoryId])
  useEffect(() => {
    let active = true
    const update = () => {
      if (document.visibilityState !== "visible") return
      getPairState(categoryId).then((result) => {
        if (!active) return
        if (result.success) setState(result.data)
        else setError(result.error.message)
      }).catch(() => { if (active) setError("Your pair information could not be loaded. Try again.") })
    }
    update()
    const timer = window.setInterval(update, 5000)
    return () => { active = false; window.clearInterval(timer) }
  }, [categoryId])
  async function run(operation: () => Promise<ApiResponse<unknown>>, successMessage: string) {
    setBusy(true); setError(""); setMessage("")
    try {
      const result = await operation()
      if (!result.success) { setError(result.error.message); return }
      setMessage(successMessage)
      await reload()
    } catch { setError("The request could not be completed. Try again.") }
    finally { setBusy(false) }
  }
  return <div className="space-y-3">
    <p className="rounded-lg bg-blue-50 p-3 text-sm text-blue-950">Each doubles pair may include at most one main-squad player. Your partner must accept before you enter the roster.</p>
    {error && <p role="alert" className="text-sm text-red-700">{error} <button className="min-h-12 underline" onClick={() => void reload()}>Reload</button></p>}
    {message && <p role="status" className="text-sm text-emerald-800">{message}</p>}
    {!state && !error && <p role="status">Loading your pair…</p>}
    {state?.registration ? <div className="rounded-xl border p-3 text-sm">
      <p className="font-semibold">{state.displayName}</p>
      <p className="mt-1">{state.registration.status === "WAITLISTED" ? "Pair on waitlist" : "Pair confirmed"}</p>
      {isOpen && <Button variant="outline" className="mt-3 min-h-12 w-full" disabled={busy} onClick={() => void run(() => withdrawRegistration(state.registration!.id), "Your pair has been withdrawn.")}>Withdraw pair</Button>}
    </div> : state && state.invitations.length > 0 ? state.invitations.map((invitation) => <div key={invitation.id} className="rounded-xl border p-3 text-sm">
      <p>{invitation.inviter_id === state.userId ? `Waiting for ${invitation.partner_name} to accept` : `${invitation.inviter_name} invited you to partner`}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {invitation.partner_id === state.userId ? <>
          <Button className="min-h-12" disabled={busy || !isOpen} onClick={() => void run(() => respondDoublesInvitation(invitation.id, "ACCEPT"), "Invitation accepted. Your pair is registered or waitlisted according to capacity.")}>Accept and enter</Button>
          <Button variant="outline" className="min-h-12" disabled={busy || !isOpen} onClick={() => void run(() => respondDoublesInvitation(invitation.id, "DECLINE"), "Invitation declined.")}>Decline</Button>
        </> : <Button variant="outline" className="min-h-12" disabled={busy || !isOpen} onClick={() => void run(() => respondDoublesInvitation(invitation.id, "CANCEL"), "Invitation cancelled.")}>Cancel invitation</Button>}
      </div>
      {!isOpen && <p className="mt-2 text-muted-foreground">Registration has closed; this invitation cannot be accepted.</p>}
    </div>) : state && isOpen ? <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); void run(() => inviteDoublesPartner(categoryId, email), "Invitation sent. Ask your partner to open this tournament and accept.") }}>
      <label htmlFor={`partner-${categoryId}`} className="text-sm font-semibold">Partner&apos;s institutional email</label>
      <Input id={`partner-${categoryId}`} type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="partner@adab.umpsa.edu.my" className="min-h-12" disabled={busy} />
      <Button type="submit" className="min-h-12 w-full" disabled={busy}>{busy ? "Saving…" : "Invite partner"}</Button>
    </form> : state && <p className="text-sm text-muted-foreground">Registration is closed.</p>}
  </div>
}
