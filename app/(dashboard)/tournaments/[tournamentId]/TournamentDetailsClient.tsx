"use client"

import * as React from "react"
import { CalendarDays, CheckCircle2, Clock3, MapPin, Users } from "lucide-react"

import {
  getPlayerRegistrations,
  registerForCategory,
  withdrawRegistration,
} from "@/app/actions/registrations"
import AutoRefresh from "@/components/AutoRefresh"
import DoublesRegistration from "@/components/DoublesRegistration"
import LiveCategoryPreview from "@/components/LiveCategoryPreview"
import type { PublishedGroup } from "@/app/actions/live-scores"
import type { LiveScore } from "@/lib/realtime/live-scores"
import type { KnockoutPreview } from "@/app/actions/knockout"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { toast } from "@/components/ui/toast"
import type {
  Category,
  Match,
  Registration,
  Tournament,
} from "@/app/(dashboard)/tournaments/types"

interface TournamentDetailsClientProps {
  managementTournamentId?: string
  canAssignOfficials: boolean
  tournamentId: string
  initialTournament: Tournament
  initialCategories: Category[]
  initialUserRegistrations: Registration[]
  initialKnockoutPreviews: Record<string, KnockoutPreview | null>
  initialCategoryMatches: Record<string, Match[]>
  initialGroups:PublishedGroup[]
  initialScores:LiveScore[]
  groupPreviewError?:string
}

function statusLabel(status: string): string {
  return status
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
}

export default function TournamentDetailsClient({
  managementTournamentId,
  canAssignOfficials,
  initialTournament,
  initialCategories,
  initialUserRegistrations,
  initialKnockoutPreviews,
  initialCategoryMatches,
  initialGroups,initialScores,groupPreviewError,
}: TournamentDetailsClientProps) {
  const categories = initialCategories
  const [registrations, setRegistrations] = React.useState(initialUserRegistrations)
  const knockoutPreviews = initialKnockoutPreviews
  const categoryMatches = initialCategoryMatches
  const [pendingCategoryId, setPendingCategoryId] = React.useState<string | null>(null)

  const visibleDraws=categories.filter((category)=>["DRAW_PUBLISHED","GROUP_STAGE_IN_PROGRESS","GROUP_STAGE_COMPLETED","KNOCKOUT_IN_PROGRESS","COMPLETED"].includes(category.status))

  const refresh = async () => {
    const response = await getPlayerRegistrations()
    if (response.success) setRegistrations(response.data)
  }

  const handleRegister = async (categoryId: string) => {
    setPendingCategoryId(categoryId)
    try {
      const response = await registerForCategory(categoryId)
      if (!response.success) {
        toast.add({
          title: "Registration not completed",
          description: response.error.message,
          type: "error",
        })
        return
      }
      toast.add({
        title: response.data.status === "WAITLISTED" ? "Added to waitlist" : "Registration confirmed",
        description:
          response.data.status === "WAITLISTED"
            ? "The committee will promote players in registration order when space opens."
            : "You are now included in the confirmed roster for this category.",
        type: "success",
      })
      await refresh()
    } finally {
      setPendingCategoryId(null)
    }
  }

  const handleWithdraw = async (registrationId: string) => {
    setPendingCategoryId(registrationId)
    try {
      const response = await withdrawRegistration(registrationId)
      if (!response.success) {
        toast.add({
          title: "Withdrawal not completed",
          description: response.error.message,
          type: "error",
        })
        return
      }
      toast.add({
        title: "Registration withdrawn",
        description: "The committee can now promote the next eligible waitlisted player.",
        type: "success",
      })
      await refresh()
    } finally {
      setPendingCategoryId(null)
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-7">
      <AutoRefresh intervalMs={60000} />
      <section className="rounded-2xl bg-primary p-6 text-primary-foreground shadow-sm sm:p-8">
        <p className="text-sm font-semibold uppercase tracking-wide text-blue-200">Tournament</p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">{initialTournament.title}</h1>
        {initialTournament.description && <p className="mt-3 max-w-3xl text-sm leading-6 text-blue-50">{initialTournament.description}</p>}
        <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm text-blue-100">
          <span className="inline-flex items-center gap-1.5"><MapPin className="size-4" aria-hidden="true" />{initialTournament.location}</span>
          <span className="inline-flex items-center gap-1.5"><CalendarDays className="size-4" aria-hidden="true" />{new Date(initialTournament.start_date).toLocaleDateString()} – {new Date(initialTournament.end_date).toLocaleDateString()}</span>
        </div>
      </section>

      <section aria-labelledby="categories-heading" className="space-y-4">
        <div>
          <h2 id="categories-heading" className="text-xl font-bold">Categories</h2>
          <p className="mt-1 text-sm text-muted-foreground">Registration availability and capacity are controlled by the committee.</p>
        </div>
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {categories.map((category) => {
            const registration = registrations.find((item) => item.category_id === category.id && item.status !== "WITHDRAWN")
            const isOpen = category.status === "REGISTRATION_OPEN"
            const isFull = (category.current_registered_count ?? 0) >= category.max_capacity
            const pending = pendingCategoryId === category.id
            return (
              <Card key={category.id} className="border-slate-200 shadow-sm">
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <CardTitle className="text-lg">{category.name}</CardTitle>
                    <Badge variant="outline" className={isOpen ? "border-blue-200 bg-blue-50 text-blue-800" : "border-slate-200 bg-slate-100 text-slate-700"}>
                      {statusLabel(category.status)}
                    </Badge>
                  </div>
                  <CardDescription>{category.format === "STANDARD_3X21" ? "Best of three games to 21" : "Single game to 30"}</CardDescription>
                  <p className="text-xs text-muted-foreground">{category.draw_format === "SINGLE_ELIMINATION" ? "Single elimination · automatic bracket and byes" : "Round-robin groups · sized after registration closes"}</p>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-muted-foreground">Confirmed</p><p className="mt-1 font-bold text-foreground">{category.current_registered_count ?? 0} / {category.max_capacity}</p></div>
                    <div className="rounded-lg bg-amber-50 p-3"><p className="text-xs text-amber-800">Waitlist</p><p className="mt-1 font-bold text-amber-950">{category.current_waitlisted_count ?? 0}</p></div>
                  </div>

                  {category.participation_format === "DOUBLES" && <DoublesRegistration categoryId={category.id} isOpen={isOpen} />}
                  {category.participation_format !== "DOUBLES" && registration?.status === "CONFIRMED" && (
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950">
                      <p className="flex items-center gap-2 font-semibold"><CheckCircle2 className="size-4" aria-hidden="true" />You are confirmed</p>
                      {isOpen && <Button variant="outline" className="mt-3 min-h-11 w-full" onClick={() => void handleWithdraw(registration.id)} disabled={pending}>Withdraw before draw</Button>}
                    </div>
                  )}
                  {category.participation_format !== "DOUBLES" && registration?.status === "WAITLISTED" && (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
                      <p className="flex items-center gap-2 font-semibold"><Clock3 className="size-4" aria-hidden="true" />You are waitlisted</p>
                      <p className="mt-1 text-xs leading-5">The committee promotes players in registration order when a confirmed place opens.</p>
                    </div>
                  )}

                  {category.participation_format !== "DOUBLES" && !registration && (
                    <Button className="min-h-11 w-full" onClick={() => void handleRegister(category.id)} disabled={!isOpen || pending}>
                      {pending ? "Saving…" : !isOpen ? "Registration closed" : isFull ? "Join waitlist" : "Register now"}
                    </Button>
                  )}
                  {!isOpen && !registration && <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground"><Users className="size-3.5" aria-hidden="true" />The committee has closed this registration stage.</p>}
                </CardContent>
              </Card>
            )
          })}
        </div>
      </section>

      {visibleDraws.length > 0 && (
        <section className="space-y-5" aria-labelledby="knockout-brackets-heading">
          <div>
            <h2 id="knockout-brackets-heading" className="text-xl font-bold">Live draws and scores</h2>
            <p className="mt-1 text-sm text-muted-foreground">Follow group matches and the knockout bracket as the umpire records each point.</p>
          </div>
          {visibleDraws.map((category)=><LiveCategoryPreview key={category.id} managementTournamentId={!["COMPLETED","ARCHIVED"].includes(initialTournament.status) && !["COMPLETED","ARCHIVED"].includes(category.status) ? managementTournamentId : undefined} canAssignOfficials={canAssignOfficials && !["COMPLETED","ARCHIVED"].includes(initialTournament.status) && !["COMPLETED","ARCHIVED"].includes(category.status)} category={category} groups={initialGroups.filter((g)=>g.category_id===category.id)} matches={categoryMatches[category.id] ?? []} preview={knockoutPreviews[category.id] ?? null} initialScores={initialScores.filter((s)=>s.category_id===category.id)} error={groupPreviewError} />)}
        </section>
      )}
    </div>
  )
}
