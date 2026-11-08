"use client"

import { useEffect, useState } from "react"
import { getTournamentSquad, setTournamentSquadMember, type SquadPlayer } from "@/app/actions/doubles"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export default function TournamentSquad({ tournamentId, locked }: { tournamentId: string; locked: boolean }) {
  const [players, setPlayers] = useState<SquadPlayer[]>([])
  const [search, setSearch] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    let active = true
    getTournamentSquad(tournamentId).then((result) => {
      if (!active) return
      if (result.success) setPlayers(result.data)
      else setError(result.error.message)
      setLoaded(true)
    }).catch(() => { if (active) { setError("The squad roster could not be loaded."); setLoaded(true) } })
    return () => { active = false }
  }, [tournamentId])
  async function toggle(player: SquadPlayer) {
    setBusy(true); setError("")
    try {
      const result = await setTournamentSquadMember(tournamentId, player.id, !player.isMainSquad)
      if (!result.success) { setError(result.error.message); return }
      setPlayers((current) => current.map((row) => row.id === player.id ? { ...row, isMainSquad: !row.isMainSquad } : row))
    } catch { setError("Squad membership could not be saved.") }
    finally { setBusy(false) }
  }
  return <details className="rounded-2xl border bg-white p-5">
    <summary className="min-h-12 cursor-pointer font-bold">Main-squad roster for this tournament</summary>
    <p className="my-3 text-sm text-muted-foreground">Set the roster before registration closes. A main-squad player may partner with a non-main-squad player; two main-squad players cannot pair.</p>
    {locked && <p className="mb-3 text-sm text-amber-800">The squad roster is locked because registration has closed.</p>}
    {error && <p role="alert" className="mb-3 text-sm text-red-700">{error}</p>}
    <label htmlFor="squad-search" className="text-sm font-semibold">Find a player</label>
    <Input id="squad-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by name or email" className="my-2 min-h-12" />
    {!loaded && <p role="status">Loading roster…</p>}
    <ul className="max-h-80 space-y-2 overflow-y-auto">
      {players.filter((p) => `${p.full_name} ${p.email}`.toLowerCase().includes(search.toLowerCase())).map((player) => <li key={player.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
        <div><p className="text-sm font-semibold">{player.full_name}{player.isMainSquad ? " · Main squad" : ""}</p><p className="text-xs text-muted-foreground">{player.email}</p></div>
        <Button variant="outline" className="min-h-12" disabled={busy || locked} onClick={() => void toggle(player)}>{player.isMainSquad ? "Remove from squad" : "Mark main squad"}</Button>
      </li>)}
    </ul>
  </details>
}
