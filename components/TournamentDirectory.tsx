"use client"

import Link from "next/link"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { CalendarDays, ChevronRight, MapPin, RefreshCw, Trophy } from "lucide-react"
import type { Tournament } from "@/app/(dashboard)/tournaments/types"
import AutoRefresh from "@/components/AutoRefresh"
import { categoryStatusLabel } from "@/lib/tournament/lifecycle"

export default function TournamentDirectory({ tournaments, canManage, error }: { tournaments: Tournament[]; canManage: boolean; error?: string }) {
  const router = useRouter()
  const [filter, setFilter] = useState("ALL")
  const visible = tournaments.filter((t) => filter === "ALL" || (filter === "OPEN" ? t.status === "REGISTRATION_OPEN" : filter === "HISTORY" ? ["COMPLETED", "ARCHIVED"].includes(t.status) : !["DRAFT", "REGISTRATION_OPEN", "COMPLETED", "ARCHIVED"].includes(t.status)))
  return <div className="mx-auto w-full max-w-7xl space-y-6">
    <AutoRefresh intervalMs={5000} />
    <section className="rounded-2xl bg-primary p-6 text-primary-foreground sm:p-8">
      <p className="text-xs font-bold uppercase tracking-widest text-blue-100">UMPSA tournament desk</p>
      <h1 className="mt-3 text-3xl font-extrabold">Your tournaments</h1>
      <p className="mt-3 text-sm leading-6 text-blue-50">{canManage ? "New drafts appear here immediately. Manage your events, open registration and follow ongoing tournaments." : "Browse open categories and follow published events, your registrations and past tournaments."}</p>
      {canManage && <Link href="/mt" className="mt-4 inline-flex min-h-12 items-center gap-2 rounded-lg bg-white px-4 text-sm font-bold text-primary">MT Dashboard <ChevronRight className="size-4" aria-hidden="true" /></Link>}
    </section>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap gap-2" aria-label="Filter tournaments">
        {[["ALL", "All events"], ["OPEN", "Registration open"], ["ONGOING", "Ongoing"], ["HISTORY", "Completed"]].map(([value, label]) => <button key={value} onClick={() => setFilter(value)} aria-pressed={filter === value} className={`min-h-12 rounded-lg border px-4 text-sm font-semibold ${filter === value ? "bg-primary text-white" : "bg-white text-primary"}`}>{label}</button>)}
      </div>
      <button onClick={() => router.refresh()} className="inline-flex min-h-12 items-center gap-2 rounded-lg border bg-white px-4 text-sm font-semibold text-primary"><RefreshCw className="size-4" aria-hidden="true" />Refresh</button>
    </div>
    {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">{error}</p>}
    {!error && visible.length === 0 && <div className="rounded-2xl border border-dashed bg-white p-12 text-center"><Trophy className="mx-auto size-9 text-primary" aria-hidden="true" /><h2 className="mt-4 font-bold">No events in this view</h2><p className="mt-2 text-sm text-muted-foreground">{canManage ? "Choose All events to see drafts, or create a tournament in the management workspace." : "New tournaments appear when the organizer opens registration."}</p></div>}
    <div className="grid gap-5 md:grid-cols-2">
      {visible.map((tournament) => <Link key={tournament.id} href={canManage && tournament.status === "DRAFT" ? `/admin/tournaments/${tournament.id}` : `/tournaments/${tournament.id}`} className="rounded-2xl border bg-white p-6 shadow-sm transition hover:border-blue-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-900">{categoryStatusLabel(tournament.status)}</span>
        <h2 className="mt-4 text-xl font-bold text-primary">{tournament.title}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{tournament.description || "UMPSA badminton tournament"}</p>
        <div className="mt-5 flex flex-wrap gap-4 text-sm text-slate-600"><span className="inline-flex items-center gap-2"><CalendarDays className="size-4" aria-hidden="true" />{new Intl.DateTimeFormat("en-MY", { dateStyle: "medium", timeZone: "Asia/Kuala_Lumpur" }).format(new Date(tournament.start_date))}</span><span className="inline-flex items-center gap-2"><MapPin className="size-4" aria-hidden="true" />{tournament.location}</span></div>
        <span className="mt-5 inline-flex min-h-12 items-center gap-2 text-sm font-bold text-primary">{canManage && tournament.status === "DRAFT" ? "Continue setup" : "View categories"}<ChevronRight className="size-4" aria-hidden="true" /></span>
      </Link>)}
    </div>
  </div>
}
