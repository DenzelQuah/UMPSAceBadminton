"use client"

import * as React from "react"
import { CalendarClock, CircleAlert, MapPin, ShieldCheck } from "lucide-react"

import type { ProfileBrief } from "@/app/actions/officials"
import { scheduleMatch as scheduleMatchAction } from "@/app/actions/matches"
import type { Match } from "@/app/(dashboard)/tournaments/types"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { toast } from "@/components/ui/toast"
import { validateMatchSchedule } from "@/lib/tournament/scheduling"
import { malaysiaDateTimeInput,malaysiaDateTimeToIso } from "@/lib/tournament/match-scheduling"

interface MatchScheduleDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  match: Match
  allMatches: Match[]
  tournament: {
    courtCount: number
    startDate: string
    endDate: string
  }
  profiles: ProfileBrief[]
  onScheduled: () => void | Promise<void>
}

function toLocalDateTime(value?: string | null): string {
  return malaysiaDateTimeInput(value)
}

export function MatchScheduleDialog({
  open,
  onOpenChange,
  match,
  allMatches,
  tournament,
  profiles,
  onScheduled,
}: MatchScheduleDialogProps) {
  const [courtNumber, setCourtNumber] = React.useState(match.court_number ?? 1)
  const [scheduledTime, setScheduledTime] = React.useState(
    toLocalDateTime(match.scheduled_time)
  )
  const [umpireId, setUmpireId] = React.useState(match.umpire_id ?? "")
  const [linesmanId, setLinesmanId] = React.useState(match.linesman_id ?? "")
  const [saving, setSaving] = React.useState(false)
  const [conflicts, setConflicts] = React.useState<string[]>([])

  const eligibleProfiles = profiles.filter(
    (profile) =>
      ![match.player_a_id, match.player_b_id, match.player_a_partner_id, match.player_b_partner_id].includes(profile.id)
  )

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const start = malaysiaDateTimeToIso(scheduledTime)
    if (!start) {
      setConflicts(["Choose a valid start date and time in Malaysia time (MYT)."])
      return
    }

    const localConflicts = validateMatchSchedule(
      {
        id: match.id,
        playerAId: match.player_a_id,
        playerBId: match.player_b_id,
        playerAPartnerId: match.player_a_partner_id,
        playerBPartnerId: match.player_b_partner_id,
        courtNumber,
        scheduledTime: start,
        umpireId: umpireId || null,
        linesmanId: linesmanId || null,
      },
      allMatches.map((existingMatch) => ({
        id: existingMatch.id,
        playerAId: existingMatch.player_a_id,
        playerBId: existingMatch.player_b_id,
        playerAPartnerId: existingMatch.player_a_partner_id,
        playerBPartnerId: existingMatch.player_b_partner_id,
        courtNumber: existingMatch.court_number,
        scheduledTime: existingMatch.scheduled_time,
        umpireId: existingMatch.umpire_id,
        linesmanId: existingMatch.linesman_id,
        status: existingMatch.status,
      }))
    ).map((conflict) => conflict.message)

    if (localConflicts.length > 0) {
      setConflicts(localConflicts)
      return
    }

    setSaving(true)
    setConflicts([])
    try {
      const response = await scheduleMatchAction({
        matchId: match.id,
        courtNumber,
        scheduledTime: start,
        umpireId: umpireId || null,
        linesmanId: linesmanId || null,
      })
      if (!response.success) {
        setConflicts([response.error.message])
        return
      }

      toast.add({
        title: "Match scheduled",
        description: "The court, player rest, and official buffers passed validation.",
        type: "success",
      })
      await onScheduled()
      onOpenChange(false)
    } catch {
      setConflicts(["The schedule could not be confirmed. Check your connection, refresh the match and try again."])
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-xl">Schedule match</DialogTitle>
          <DialogDescription>
            {match.player_a_name ?? "Player A"} vs {match.player_b_name ?? "Player B"}
          </DialogDescription>
          {!match.scheduled_time && <p className="text-sm text-amber-900">Time TBA. Announce the match time and court when ready. Other groups or rounds can continue while this fixture waits.</p>}
        </DialogHeader>

        <form onSubmit={submit} className="space-y-5 pt-2">
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor={`${match.id}-court`}>Court</Label>
              <div className="relative">
                <MapPin className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-500" aria-hidden="true" />
                <Input
                  id={`${match.id}-court`}
                  type="number"
                  min={1}
                  max={tournament.courtCount}
                  className="min-h-11 pl-9"
                  value={courtNumber}
                  onChange={(event) => setCourtNumber(Number(event.target.value))}
                  required
                />
              </div>
              <p className="text-xs text-slate-500">
                {tournament.courtCount} courts configured
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor={`${match.id}-time`}>Start time (MYT)</Label>
              <div className="relative">
                <CalendarClock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-500" aria-hidden="true" />
                <Input
                  id={`${match.id}-time`}
                  type="datetime-local"
                  className="min-h-11 pl-9"
                  min={toLocalDateTime(tournament.startDate)}
                  max={toLocalDateTime(tournament.endDate)}
                  value={scheduledTime}
                  onChange={(event) => setScheduledTime(event.target.value)}
                  required
                />
              </div>
            </div>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor={`${match.id}-umpire`}>Umpire</Label>
              <select
                id={`${match.id}-umpire`}
                className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none transition focus:border-blue-600 focus:ring-3 focus:ring-blue-100"
                value={umpireId}
                onChange={(event) => setUmpireId(event.target.value)}
              >
                <option value="">Assign later</option>
                {eligibleProfiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.full_name}{profile.organizational_role ? ` ? ${profile.organizational_role}${profile.organizational_role_detail ? ` ? ${profile.organizational_role_detail}` : ""}` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${match.id}-linesman`}>Linesman</Label>
              <select
                id={`${match.id}-linesman`}
                className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none transition focus:border-blue-600 focus:ring-3 focus:ring-blue-100"
                value={linesmanId}
                onChange={(event) => setLinesmanId(event.target.value)}
              >
                <option value="">Assign later</option>
                {eligibleProfiles.map((profile) => (
                  <option
                    key={profile.id}
                    value={profile.id}
                    disabled={profile.id === umpireId}
                  >
                    {profile.full_name}{profile.organizational_role ? ` ? ${profile.organizational_role}${profile.organizational_role_detail ? ` ? ${profile.organizational_role_detail}` : ""}` : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
            <p className="flex items-center gap-2 font-semibold text-slate-900">
              <ShieldCheck className="size-4 text-emerald-700" aria-hidden="true" />
              Scheduling safeguards
            </p>
            <ul className="mt-2 list-inside list-disc space-y-1 text-xs leading-5">
              <li>40-minute court blocks with no court collision</li>
              <li>20-minute player rest and no double-booking</li>
              <li>No self-officiating or simultaneous official duty</li>
              <li>70-minute player/official start-time buffer</li>
            </ul>
          </div>

          {conflicts.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950" role="alert">
              <p className="flex items-center gap-2 font-semibold">
                <CircleAlert className="size-4" aria-hidden="true" />
                Resolve these conflicts before saving
              </p>
              <ul className="mt-2 list-inside list-disc space-y-1">
                {conflicts.map((conflict) => (
                  <li key={conflict}>{conflict}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-col-reverse gap-3 border-t pt-5 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="submit" className="min-h-11" disabled={saving}>
              {saving ? "Checking conflicts…" : "Validate and schedule"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
