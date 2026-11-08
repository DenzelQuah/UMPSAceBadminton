"use client"

import TournamentSquad from "@/components/TournamentSquad"

import * as React from "react"
import {
  AlertTriangle,
  Archive,
  ArrowLeft,
  BadgeCheck,
  CalendarDays,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  Crown,
  Info,
  MapPin,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldCheck,
  Sparkles,
  Trophy,
  UserCheck,
  Users,
  X,
} from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"

import {
  archiveTournament,
  cancelTournamentDrawPreview,
  completeTournament,
  generateTournamentDraw,
  getCategoryDrawPreview,
  publishTournamentDraw,
  type DrawPreview,
} from "@/app/actions/tournaments"
import {
  getCategories,
  getCategoryRegistrations,
  promoteNextWaitlistedPlayer,
  updateCategoryQualifierCount,
  updateCategoryStatus,
  updateRegistrationSeed,
  type CategoryRegistration,
} from "@/app/actions/categories"
import { getCategoryMatches } from "@/app/actions/matches"
import {
  getKnockoutPreview,
  prepareKnockoutBracket,
  publishKnockoutBracket,
  type KnockoutPreview,
} from "@/app/actions/knockout"
import type { ProfileBrief } from "@/app/actions/officials"
import MatchOfficialAssignmentLink from "@/components/MatchOfficialAssignmentLink"
import KnockoutBracket from "@/components/KnockoutBracket"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { toast } from "@/components/ui/toast"
import type { Category, Match, Tournament } from "@/app/(dashboard)/tournaments/types"
import { cn } from "@/lib/utils"
import { getMatchStageLabel } from "@/lib/tournament/stages"
import { AddCategoryDialog } from "./AddCategoryDialog"
import { MatchScheduleDialog } from "./MatchScheduleDialog"
import { canEditMatchSchedule } from "@/lib/tournament/match-scheduling"

interface TournamentAdminClientProps {
  initialCategoryId?: string
  initialScheduleMatchId?: string | null
  doublesAvailable?: boolean
  knockoutAvailable?: boolean
  tournamentId: string
  initialTournament: Tournament
  initialCategories: Category[]
  initialProfiles: ProfileBrief[]
  initialRegistrations: CategoryRegistration[]
  initialMatches: Match[]
  initialPreview: DrawPreview | null
}

const phaseLabels = ["Setup", "Registration", "Seeds", "Draw preview", "Schedule"]

function statusLabel(status: string): string {
  return status
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
}

function statusClass(status: string): string {
  if (["DRAW_PUBLISHED", "COMPLETED", "GROUP_STAGE_COMPLETED"].includes(status)) {
    return "border-emerald-200 bg-emerald-50 text-emerald-800"
  }
  if (["REGISTRATION_OPEN", "GROUP_STAGE_IN_PROGRESS"].includes(status)) {
    return "border-blue-200 bg-blue-50 text-blue-800"
  }
  if (["REGISTRATION_CLOSED", "DRAW_PREPARATION", "DRAW_GENERATED"].includes(status)) {
    return "border-amber-200 bg-amber-50 text-amber-900"
  }
  if (["CANCELLED", "ARCHIVED"].includes(status)) {
    return "border-red-200 bg-red-50 text-red-800"
  }
  return "border-slate-200 bg-slate-100 text-slate-800"
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-MY", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value))
}

function formatDateTime(value: string | null): string {
  if (!value) return "Not scheduled"
  return new Intl.DateTimeFormat("en-MY", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value))
}

function phaseForStatus(status: string): number {
  if (status === "DRAFT") return 0
  if (status === "REGISTRATION_OPEN") return 1
  if (["REGISTRATION_CLOSED", "DRAW_PREPARATION"].includes(status)) return 2
  if (status === "DRAW_GENERATED") return 3
  return 4
}

function WorkflowStepper({ status }: { status: string }) {
  const activePhase = phaseForStatus(status)
  return (
    <ol className="grid gap-2 sm:grid-cols-5" aria-label="Tournament workflow">
      {phaseLabels.map((label, index) => {
        const complete = index < activePhase
        const active = index === activePhase
        return (
          <li key={label} className="relative">
            <div
              className={cn(
                "flex min-h-12 items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold transition",
                complete && "border-emerald-200 bg-emerald-50 text-emerald-800",
                active && "border-blue-300 bg-blue-50 text-blue-900 ring-2 ring-blue-100",
                !complete && !active && "border-slate-200 bg-white text-slate-500"
              )}
              aria-current={active ? "step" : undefined}
            >
              <span
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full text-xs",
                  complete && "bg-emerald-600 text-white",
                  active && "bg-blue-700 text-white",
                  !complete && !active && "bg-slate-100 text-slate-500"
                )}
              >
                {complete ? <Check className="size-3.5" aria-hidden="true" /> : index + 1}
              </span>
              <span>{label}</span>
            </div>
          </li>
        )
      })}
    </ol>
  )
}

function Metric({
  label,
  value,
  detail,
  icon: Icon,
  className,
}: {
  label: string
  value: string | number
  detail: string
  icon: typeof Users
  className?: string
}) {
  return (
    <div className={cn("rounded-xl border bg-white p-4", className)}>
      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <Icon className="size-4" aria-hidden="true" />
        {label}
      </div>
      <p className="mt-2 text-2xl font-bold tracking-tight text-foreground">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </div>
  )
}

export default function TournamentAdminClient({
  initialCategoryId,
  initialScheduleMatchId=null,
  tournamentId,
  initialTournament,
  initialCategories,
  initialProfiles,
  initialRegistrations,
  initialMatches,
  initialPreview,
  doublesAvailable = true,
  knockoutAvailable = true,
}: TournamentAdminClientProps) {
  const router = useRouter()
  const [categories, setCategories] = React.useState(initialCategories)
  const [selectedCategoryId, setSelectedCategoryId] = React.useState<string | null>(
    initialCategoryId ?? initialCategories[0]?.id ?? null
  )
  const [registrations, setRegistrations] = React.useState<CategoryRegistration[]>(initialRegistrations)
  const [matches, setMatches] = React.useState<Match[]>(initialMatches)
  const [preview, setPreview] = React.useState<DrawPreview | null>(initialPreview)
  const [knockoutPreview, setKnockoutPreview] = React.useState<KnockoutPreview | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [action, setAction] = React.useState<string | null>(null)
  const [seedDrafts, setSeedDrafts] = React.useState<Record<string, string>>({})
  const [publishOpen, setPublishOpen] = React.useState(false)
  const [cancelOpen, setCancelOpen] = React.useState(false)
  const [completeOpen, setCompleteOpen] = React.useState(false)
  const [archiveOpen, setArchiveOpen] = React.useState(false)
  const [scheduleMatchId, setScheduleMatchId] = React.useState<string | null>(initialScheduleMatchId)
  const requestId = React.useRef(0)
  const selectedCategoryIdRef = React.useRef(selectedCategoryId)
  const isTerminalTournament = ["COMPLETED", "ARCHIVED"].includes(initialTournament.status)

  React.useEffect(() => {
    selectedCategoryIdRef.current = selectedCategoryId
  }, [selectedCategoryId])

  const selectedCategory = categories.find((category) => category.id === selectedCategoryId)
  const confirmedRegistrations = registrations.filter((registration) => registration.status === "CONFIRMED")
  const waitlistedRegistrations = registrations.filter((registration) => registration.status === "WAITLISTED")
  const seededPlayers = confirmedRegistrations.filter((registration) => registration.seed_number)
  const scheduleWorkspaceVisible = [
    "DRAW_PUBLISHED",
    "GROUP_STAGE_IN_PROGRESS",
    "GROUP_STAGE_COMPLETED",
    "KNOCKOUT_IN_PROGRESS",
    "COMPLETED",
  ].includes(selectedCategory?.status ?? "")
  const isDirectElimination = selectedCategory?.draw_format === "SINGLE_ELIMINATION"
  const groupStageMatches = matches.filter((match) => match.group_id !== null)
  const knockoutMatches = matches.filter((match) => match.knockout_round !== null)
  const groupStageComplete =
    groupStageMatches.length > 0 &&
    groupStageMatches.every((match) => ["COMPLETED", "WALKOVER", "RETIRED"].includes(match.status))
  const knockoutWorkspaceVisible = isDirectElimination ||
    selectedCategory?.status === "DRAW_PUBLISHED" ||
    selectedCategory?.status === "GROUP_STAGE_COMPLETED" ||
    selectedCategory?.status === "KNOCKOUT_IN_PROGRESS" ||
    selectedCategory?.status === "COMPLETED"

  const loadCategoryData = React.useCallback(async (categoryId: string) => {
    const currentRequest = requestId.current + 1
    requestId.current = currentRequest
    setLoading(true)
    setRegistrations([])
    setMatches([])
    setPreview(null)
    setKnockoutPreview(null)
    const [registrationResult, matchResult, previewResult, knockoutResult] = await Promise.all([
      getCategoryRegistrations(categoryId),
      getCategoryMatches(categoryId),
      getCategoryDrawPreview(categoryId),
      getKnockoutPreview(categoryId),
    ])

    if (requestId.current !== currentRequest) return
    if (registrationResult.success) setRegistrations(registrationResult.data)
    if (matchResult.success) setMatches(matchResult.data)
    if (previewResult.success) setPreview(previewResult.data)
    if (knockoutResult.success) setKnockoutPreview(knockoutResult.data)

    const firstError = !registrationResult.success
      ? registrationResult.error
      : !matchResult.success
        ? matchResult.error
        : !previewResult.success
          ? previewResult.error
          : null
    if (firstError) {
      toast.add({
        title: "Category data could not be loaded",
        description: firstError.message,
        type: "error",
      })
    }
    setLoading(false)
  }, [])

  React.useEffect(() => {
    if (!selectedCategoryId || action !== null || loading) return
    let disposed = false

    const refreshLiveCategory = async () => {
      if (document.visibilityState === "hidden") return
      const [matchResult, categoryResult, bracketResult] = await Promise.all([
        getCategoryMatches(selectedCategoryId),
        getCategories(tournamentId),
        getKnockoutPreview(selectedCategoryId),
      ])
      if (disposed) return
      if (matchResult.success) setMatches(matchResult.data)
      if (categoryResult.success) setCategories(categoryResult.data)
      if (bracketResult.success) setKnockoutPreview(bracketResult.data)
    }

    const handleFocus = () => void refreshLiveCategory()
    const handleVisibilityChange = () => void refreshLiveCategory()
    const timer = window.setInterval(() => void refreshLiveCategory(), 5000)
    window.addEventListener("focus", handleFocus)
    document.addEventListener("visibilitychange", handleVisibilityChange)
    void refreshLiveCategory()

    return () => {
      disposed = true
      window.clearInterval(timer)
      window.removeEventListener("focus", handleFocus)
      document.removeEventListener("visibilitychange", handleVisibilityChange)
    }
  }, [action, loading, selectedCategoryId, tournamentId])

  const refreshCategories = React.useCallback(async () => {
    const result = await getCategories(tournamentId)
    if (result.success) {
      setCategories(result.data)
      setSelectedCategoryId((current) => current ?? result.data[0]?.id ?? null)
    } else {
      toast.add({
        title: "Categories could not be refreshed",
        description: result.error.message,
        type: "error",
      })
    }
  }, [tournamentId])

  const selectCategory = (categoryId: string) => {
    if (categoryId === selectedCategoryId || loading || action !== null) return
    selectedCategoryIdRef.current = categoryId
    setSelectedCategoryId(categoryId)
    void loadCategoryData(categoryId)
  }

  const showActionError = (title: string, message: string) => {
    toast.add({ title, description: message, type: "error" })
  }

  const handleGeneratePreview = async () => {
    const categoryId = selectedCategoryId
    if (!categoryId) return
    setAction(`draw:${categoryId}`)
    try {
      const result = await generateTournamentDraw(categoryId)
      if (!result.success) {
        showActionError("Draw preview not generated", result.error.message)
        return
      }
      if (selectedCategoryIdRef.current !== categoryId) return
      setPreview(result.data.preview)
      toast.add({
        title: "Private draw preview ready",
        description: `${result.data.matchesCount} matches are staged. Review the groups before publishing.`,
        type: "success",
      })
      await refreshCategories()
    } finally {
      setAction(null)
    }
  }

  const handlePublish = async () => {
    const categoryId = selectedCategoryId
    if (!categoryId) return
    setAction(`publish:${categoryId}`)
    try {
      const result = await publishTournamentDraw(categoryId)
      if (!result.success) {
        showActionError("Draw not published", result.error.message)
        return
      }
      if (selectedCategoryIdRef.current !== categoryId) return
      setPublishOpen(false)
      toast.add({
        title: "Official draw published",
        description: `${result.data.matchesCount} matches are now ready for scheduling.`,
        type: "success",
      })
      await refreshCategories()
      await loadCategoryData(categoryId)
    } finally {
      setAction(null)
    }
  }

  const handleCancelPreview = async () => {
    const categoryId = selectedCategoryId
    if (!categoryId) return
    setAction(`cancel:${categoryId}`)
    try {
      const result = await cancelTournamentDrawPreview(categoryId)
      if (!result.success) {
        showActionError("Preview not cancelled", result.error.message)
        return
      }
      if (selectedCategoryIdRef.current !== categoryId) return
      setCancelOpen(false)
      setPreview(null)
      setKnockoutPreview(null)
      toast.add({
        title: "Draw preview cancelled",
        description: "The category is back in registration-closed preparation.",
        type: "success",
      })
      await refreshCategories()
      await loadCategoryData(categoryId)
    } finally {
      setAction(null)
    }
  }

  const handlePrepareKnockout = async () => {
    const categoryId = selectedCategoryId
    if (!categoryId) return
    setAction(`knockout:prepare:${categoryId}`)
    try {
      const result = await prepareKnockoutBracket(categoryId)
      if (!result.success) {
        showActionError("Knockout proposal unavailable", result.error.message)
        return
      }
      if (selectedCategoryIdRef.current !== categoryId) return
      setKnockoutPreview(result.data)
      toast.add({
        title: "Knockout proposal ready",
        description: "Review the seeded bracket, then publish it to create the first knockout round.",
        type: "success",
      })
      await refreshCategories()
    } finally {
      setAction(null)
    }
  }

  const handlePublishKnockout = async () => {
    const categoryId = selectedCategoryId
    if (!categoryId) return
    setAction(`knockout:publish:${categoryId}`)
    try {
      const result = await publishKnockoutBracket(categoryId)
      if (!result.success) {
        showActionError("Knockout bracket not published", result.error.message)
        return
      }
      if (selectedCategoryIdRef.current !== categoryId) return
      toast.add({
        title: "Knockout bracket published",
        description: `${result.data.matchCount} first-round matches are ready to schedule.`,
        type: "success",
      })
      await refreshCategories()
      await loadCategoryData(categoryId)
    } finally {
      setAction(null)
    }
  }

  const handleQualifierCountUpdate = async () => {
    const categoryId = selectedCategoryId
    if (!categoryId) return
    const input = document.getElementById(`qualifier-count-${categoryId}`) as HTMLInputElement | null
    const value = Number(input?.value)
    if (!input || !Number.isInteger(value) || value < 1) {
      showActionError("Qualifier count not saved", "Enter a positive whole number.")
      return
    }

    setAction(`qualifiers:${categoryId}`)
    try {
      const result = await updateCategoryQualifierCount(categoryId, value)
      if (!result.success) {
        showActionError("Qualifier count not saved", result.error.message)
        return
      }
      toast.add({
        title: "Qualifier count updated",
        description: `${result.data.qualifiersPerGroup} qualifier(s) will advance per group.`,
        type: "success",
      })
      await refreshCategories()
    } finally {
      setAction(null)
    }
  }

  const handleSeed = async (registration: CategoryRegistration) => {
    if (!selectedCategoryId) return
    const rawValue = seedDrafts[registration.id] ?? ""
    const seedNumber = rawValue.trim() === "" ? null : Number(rawValue)
    if (seedNumber !== null && (!Number.isInteger(seedNumber) || seedNumber < 1)) {
      showActionError("Seed not saved", "Seed numbers must be positive whole numbers.")
      return
    }

    setAction(`seed:${registration.id}`)
    try {
      const result = await updateRegistrationSeed(registration.id, seedNumber)
      if (!result.success) {
        showActionError("Seed not saved", result.error.message)
        return
      }
      setRegistrations((current) =>
        current.map((item) =>
          item.id === registration.id
            ? { ...item, seed_number: result.data.seedNumber }
            : item
        )
      )
      toast.add({ title: "Seed updated", type: "success" })
    } finally {
      setAction(null)
    }
  }

  const handlePromote = async () => {
    const categoryId = selectedCategoryId
    if (!categoryId) return
    setAction(`promote:${categoryId}`)
    try {
      const result = await promoteNextWaitlistedPlayer(categoryId)
      if (!result.success) {
        showActionError("Waitlist not changed", result.error.message)
        return
      }
      if (selectedCategoryIdRef.current !== categoryId) return
      toast.add({ title: "Next player promoted", type: "success" })
      await loadCategoryData(categoryId)
      await refreshCategories()
    } finally {
      setAction(null)
    }
  }

  const handleCompleteTournament = async () => {
    setAction("complete")
    try {
      const result = await completeTournament(tournamentId)
      if (!result.success) {
        showActionError("Tournament not completed", result.error.message)
        return
      }
      setCompleteOpen(false)
      toast.add({ title: "Tournament completed", description: "All final results are now preserved for the season record.", type: "success" })
      router.refresh()
    } finally {
      setAction(null)
    }
  }

  const handleArchiveTournament = async () => {
    setAction("archive")
    try {
      const result = await archiveTournament(tournamentId)
      if (!result.success) {
        showActionError("Tournament not archived", result.error.message)
        return
      }
      setArchiveOpen(false)
      toast.add({ title: "Tournament archived", description: "The event is retained in tournament history.", type: "success" })
      router.refresh()
    } finally {
      setAction(null)
    }
  }

  const scheduleTarget = matches.find((match) => match.id === scheduleMatchId)

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-7">
      {doublesAvailable && <TournamentSquad tournamentId={tournamentId} locked={isTerminalTournament || categories.some((category) => !["DRAFT", "REGISTRATION_OPEN"].includes(category.status))} />}
      <div className="flex flex-col gap-4">
        <Link
          href="/admin"
          className="inline-flex min-h-11 w-fit items-center gap-2 rounded-lg text-sm font-semibold text-primary hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back to committee workspace
        </Link>
        <div className="flex flex-col gap-5 border-b pb-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2 text-sm font-medium text-muted-foreground">
              <Badge variant="outline" className="bg-blue-50 text-blue-800">Tournament workspace</Badge>
              <span>Managed by approved committee access</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-primary sm:text-3xl">
              {initialTournament.title}
            </h1>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="size-4" aria-hidden="true" />
                {initialTournament.location}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <CalendarDays className="size-4" aria-hidden="true" />
                {formatDate(initialTournament.start_date)} – {formatDate(initialTournament.end_date)}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Trophy className="size-4" aria-hidden="true" />
                {initialTournament.court_count} courts
              </span>
            </div>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            {initialTournament.status === "COMPLETED" && (
              <Button variant="outline" className="min-h-11 gap-2" onClick={() => setArchiveOpen(true)} disabled={action !== null}>
                <Archive className="size-4" aria-hidden="true" /> Archive tournament
              </Button>
            )}
            {initialTournament.status !== "COMPLETED" && initialTournament.status !== "ARCHIVED" && (
              <Button variant="outline" className="min-h-11 gap-2" onClick={() => setCompleteOpen(true)} disabled={action !== null}>
                <Trophy className="size-4" aria-hidden="true" /> Complete tournament
              </Button>
            )}
            {!isTerminalTournament && (
              <AddCategoryDialog tournamentId={tournamentId} onCreated={refreshCategories} doublesAvailable={doublesAvailable} />
            )}
          </div>
        </div>
      </div>

      {initialTournament.description && (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm leading-6 text-slate-700">
          {initialTournament.description}
        </div>
      )}

      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="border-b bg-slate-50/70">
          <CardTitle className="text-lg">Tournament workflow</CardTitle>
          <CardDescription>Each stage has a visible guardrail so the committee can act quickly without skipping review.</CardDescription>
        </CardHeader>
        <CardContent className="p-4 sm:p-5">
          <WorkflowStepper status={selectedCategory?.status ?? "DRAFT"} />
        </CardContent>
      </Card>

      {isTerminalTournament && (
        <div className="flex items-start gap-3 rounded-xl border border-slate-300 bg-slate-100 p-4 text-sm leading-6 text-slate-700" role="status">
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-slate-600" aria-hidden="true" />
          <p><span className="font-semibold">Read-only tournament record.</span> This event is {statusLabel(initialTournament.status).toLowerCase()}; setup, draw, schedule, and official changes are disabled.</p>
        </div>
      )}

      <section aria-labelledby="categories-heading" className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="categories-heading" className="text-lg font-bold">Categories</h2>
            <p className="text-sm text-muted-foreground">Select a category to manage its roster, draw, schedule, and officials.</p>
          </div>
          <p className="text-xs font-medium text-muted-foreground">{categories.length} configured</p>
        </div>

        {categories.length === 0 ? (
          <Card className="border-dashed shadow-none">
            <CardContent className="flex flex-col items-center px-6 py-14 text-center">
              <div className="flex size-14 items-center justify-center rounded-2xl bg-blue-50 text-blue-700">
                <Users className="size-7" aria-hidden="true" />
              </div>
              <h3 className="mt-4 text-base font-semibold">Add the first category</h3>
              <p className="mt-1 max-w-md text-sm leading-6 text-muted-foreground">
                Categories keep player pools, seeds, groups, matches, and standings independent for this MVP.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {categories.map((category) => {
              const selected = category.id === selectedCategoryId
              const confirmedCount = category.current_registered_count ?? 0
              const additionalConfirmedNeeded = Math.max(
                0,
                2 - confirmedCount
              )
              const canCloseRegistration = additionalConfirmedNeeded === 0
              const progress = Math.min(100, (confirmedCount / category.max_capacity) * 100)
              return (
                <Card
                  key={category.id}
                  className={cn(
                    "relative overflow-hidden border-slate-200 shadow-sm transition",
                    selected && "border-blue-400 ring-2 ring-blue-100"
                  )}
                >
                  <CardContent className="p-5">
                    <button
                      type="button"
                      className="block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      onClick={() => selectCategory(category.id)}
                      disabled={loading || action !== null}
                       aria-busy={loading || action !== null}
                       aria-pressed={selected}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-base font-bold text-foreground">{category.name}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {category.draw_format === "SINGLE_ELIMINATION" ? "Single elimination - automatic bracket size" : `Automatic groups - target ${category.target_group_size ?? 4} entries per group`}
                          </p>
                        </div>
                        <Badge variant="outline" className={statusClass(category.status)}>
                          {statusLabel(category.status)}
                        </Badge>
                      </div>
                      <div className="mt-5">
                        <div className="mb-2 flex items-center justify-between text-xs">
                          <span className="font-medium text-slate-600">Confirmed roster</span>
                          <span className="font-bold text-slate-900">
                            {confirmedCount} / {category.max_capacity}
                          </span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={confirmedCount} aria-valuemin={0} aria-valuemax={category.max_capacity} aria-label={`${category.name} confirmed roster capacity`}>
                          <div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${progress}%` }} />
                        </div>
                        {category.current_waitlisted_count ? (
                          <p className="mt-2 text-xs font-medium text-amber-800">
                            {category.current_waitlisted_count} waitlisted
                          </p>
                        ) : null}
                      </div>
                    </button>
                    <div className="mt-5 border-t pt-4">
                      {category.status === "DRAFT" && (
                        <Button className="min-h-11 w-full" onClick={() => void handleStatusForCategory(category.id, "REGISTRATION_OPEN")} disabled={action !== null || isTerminalTournament}>
                          Open registration
                        </Button>
                      )}
                      {category.status === "REGISTRATION_OPEN" && (
                        <>
                          <Button
                            className="min-h-11 w-full"
                            variant="outline"
                            onClick={() => void handleStatusForCategory(category.id, "REGISTRATION_CLOSED")}
                            disabled={action !== null || isTerminalTournament || !canCloseRegistration}
                          >
                            {canCloseRegistration
                              ? "Close registration"
                              : `Need ${additionalConfirmedNeeded} more confirmed`}
                          </Button>
                          {!canCloseRegistration && (
                            <p className="mt-2 text-xs leading-5 text-amber-800">
                              Confirm at least two entries before closing registration. The group count is automatic.
                            </p>
                          )}
                        </>
                      )}
                      {!["DRAFT", "REGISTRATION_OPEN"].includes(category.status) && (
                        <Button className="min-h-11 w-full" variant={selected ? "default" : "outline"} onClick={() => selectCategory(category.id)}>
                          {selected ? "Workspace selected" : "Open workspace"}
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}
      </section>

      {selectedCategory && (
        <section aria-labelledby="category-workspace-heading" className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 id="category-workspace-heading" className="text-xl font-bold">{selectedCategory.name}</h2>
                <Badge variant="outline" className={statusClass(selectedCategory.status)}>{statusLabel(selectedCategory.status)}</Badge>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">Review the roster and official workflow before moving to the next stage.</p>
            </div>
            <Button variant="outline" className="min-h-11 w-fit gap-2" onClick={() => void loadCategoryData(selectedCategory.id)} disabled={loading || action !== null}>
              <RefreshCw className={cn("size-4", loading && "animate-spin")} aria-hidden="true" />
              Refresh data
            </Button>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Metric label="Confirmed" value={confirmedRegistrations.length} detail="Eligible for the draw" icon={CheckCircle2} />
            <Metric label="Waitlisted" value={waitlistedRegistrations.length} detail="Promote in order" icon={Clock3} className="border-amber-200 bg-amber-50/50" />
            <Metric label="Seeds assigned" value={seededPlayers.length} detail={isDirectElimination ? "Unseeded entries are randomized" : "Seeds spread across automatic groups"} icon={Crown} className="border-violet-200 bg-violet-50/50" />
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <Card className="border-slate-200 shadow-sm">
              <CardHeader className="border-b bg-slate-50/70">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-lg"><ClipboardCheck className="size-5 text-blue-700" aria-hidden="true" />Roster and seeds</CardTitle>
                    <CardDescription>Every confirmed player appears once. Seeds remain editable until the draw is generated.</CardDescription>
                  </div>
                  {waitlistedRegistrations.length > 0 && ["REGISTRATION_OPEN"].includes(selectedCategory.status) && (
                    <Button size="sm" className="min-h-10 shrink-0" onClick={() => void handlePromote()} disabled={action !== null || isTerminalTournament}>
                      Promote next
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {loading ? (
                  <div className="flex min-h-48 items-center justify-center gap-3 text-sm text-muted-foreground"><RefreshCw className="size-4 animate-spin" aria-hidden="true" />Loading roster…</div>
                ) : registrations.length === 0 ? (
                  <div className="px-6 py-12 text-center text-sm text-muted-foreground">No players have registered yet.</div>
                ) : (
                  <div className="divide-y">
                    {registrations.map((registration) => {
                      const isConfirmed = registration.status === "CONFIRMED"
                      const waitlistPosition = waitlistedRegistrations.findIndex((item) => item.id === registration.id) + 1
                      const draftValue = seedDrafts[registration.id] ?? (registration.seed_number?.toString() ?? "")
                      return (
                        <div key={registration.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                          <div className="flex min-w-0 items-center gap-3">
                            <div className={cn("flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-bold", isConfirmed ? "bg-blue-100 text-blue-800" : "bg-amber-100 text-amber-900")}>
                              {isConfirmed ? <Check className="size-4" aria-hidden="true" /> : waitlistPosition}
                            </div>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-foreground">{registration.player?.full_name ?? "Unknown player"}</p>
                              <p className="truncate text-xs text-muted-foreground">{registration.player?.email ?? "Email unavailable"}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-3 sm:shrink-0">
                            <Badge variant="outline" className={isConfirmed ? "border-blue-200 bg-blue-50 text-blue-800" : "border-amber-200 bg-amber-50 text-amber-900"}>
                              {isConfirmed ? "Confirmed" : registration.status === "WAITLISTED" ? `Waitlist #${waitlistPosition}` : "Withdrawn"}
                            </Badge>
                            {isConfirmed && !["DRAW_GENERATED", "DRAW_PUBLISHED"].includes(selectedCategory.status) && (
                              <div className="flex items-center gap-1.5">
                                <label htmlFor={`seed-${registration.id}`} className="sr-only">Seed for {registration.player?.full_name ?? "player"}</label>
                                <Input
                                  id={`seed-${registration.id}`}
                                  type="number"
                                  min={1}
                                  inputMode="numeric"
                                  className="h-10 w-20 px-2 text-center"
                                  value={draftValue}
                                  onChange={(event) => setSeedDrafts((current) => ({ ...current, [registration.id]: event.target.value }))}
                                  placeholder="—"
                                />
                                <Button
                                  size="icon"
                                  variant="outline"
                                  className="size-10"
                                  aria-label={`Save seed for ${registration.player?.full_name ?? "player"}`}
                                  onClick={() => void handleSeed(registration)}
                                  disabled={action !== null || isTerminalTournament}
                                >
                                  <Save className="size-4" aria-hidden="true" />
                                </Button>
                              </div>
                            )}
                            {registration.seed_number && (
                              <span className="text-xs font-bold text-violet-800">Seed {registration.seed_number}</span>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            {!isDirectElimination && <Card className="border-slate-200 shadow-sm">
              <CardHeader className="border-b bg-slate-50/70">
                <CardTitle className="flex items-center gap-2 text-lg"><Sparkles className="size-5 text-amber-600" aria-hidden="true" />Draw preview</CardTitle>
                <CardDescription>Generate privately, inspect the groups, then publish only when the roster is correct.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5 p-5">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-sm font-semibold text-slate-900">Preflight checklist</p>
                  <ul className="mt-3 space-y-2 text-sm">
                    <li className="flex items-center gap-2 text-slate-700"><CheckCircle2 className="size-4 text-emerald-600" aria-hidden="true" />Registration is {statusLabel(selectedCategory.status).toLowerCase()}</li>
                    <li className={cn("flex items-center gap-2", confirmedRegistrations.length >= 2 ? "text-slate-700" : "text-amber-800")}>
                      {confirmedRegistrations.length >= 2 ? <CheckCircle2 className="size-4 text-emerald-600" aria-hidden="true" /> : <AlertTriangle className="size-4 text-amber-600" aria-hidden="true" />}
                      {confirmedRegistrations.length} confirmed entries - groups are sized automatically
                    </li>
                    <li className="flex items-center gap-2 text-slate-700"><Info className="size-4 text-blue-600" aria-hidden="true" />{seededPlayers.length} seed{seededPlayers.length === 1 ? "" : "s"} assigned; unseeded players are randomized</li>
                  </ul>
                </div>

                {["REGISTRATION_CLOSED", "DRAW_PREPARATION", "DRAW_GENERATED"].includes(selectedCategory.status) && (
                  <div className="flex flex-col gap-3 sm:flex-row">
                    <Button className="min-h-11 flex-1" onClick={() => void handleGeneratePreview()} disabled={action !== null || isTerminalTournament || confirmedRegistrations.length < 2}>
                      <Sparkles className="size-4" aria-hidden="true" />
                      {preview ? "Regenerate preview" : "Generate preview"}
                    </Button>
                    {preview && preview.status === "READY" && (
                      <Button variant="outline" className="min-h-11" onClick={() => setCancelOpen(true)} disabled={action !== null || isTerminalTournament}>
                        <X className="size-4" aria-hidden="true" />Cancel
                      </Button>
                    )}
                  </div>
                )}

                {(preview?.status === "READY" || preview?.status === "PUBLISHED") && (
                  <div className="space-y-4">
                    {preview.status === "READY" && (
                       <div className="flex flex-col gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="font-semibold text-blue-950">Private preview ready</p>
                        <p className="mt-1 text-sm text-blue-900">{preview.matchesCount} round-robin matches staged; players cannot see this yet.</p>
                      </div>
                      <Button className="min-h-11 shrink-0" onClick={() => setPublishOpen(true)} disabled={action !== null || isTerminalTournament}>
                        <BadgeCheck className="size-4" aria-hidden="true" />Publish draw
                      </Button>
                    </div>
                    )}
                    <div className="grid gap-3 sm:grid-cols-2">
                      {preview.groups.map((group) => (
                        <div key={group.name} className="rounded-xl border border-slate-200 bg-white p-4">
                          <div className="flex items-center justify-between gap-3">
                            <h3 className="font-bold text-slate-900">{group.name}</h3>
                            <Badge variant="outline">{group.players.length} players</Badge>
                          </div>
                          <ol className="mt-3 space-y-2">
                            {group.players.map((player) => (
                              <li key={player.id} className="flex items-center justify-between gap-2 text-sm">
                                <span className="truncate text-slate-700">{player.full_name}</span>
                                {player.seed_number ? <span className="shrink-0 text-xs font-bold text-violet-800">Seed {player.seed_number}</span> : null}
                              </li>
                            ))}
                          </ol>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {selectedCategory.status === "DRAW_PUBLISHED" && (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                    <p className="flex items-center gap-2 font-semibold text-emerald-950"><BadgeCheck className="size-5" aria-hidden="true" />Official draw published</p>
                    <p className="mt-1 text-sm leading-6 text-emerald-900">The final groups and round-robin matches are now available to players. Assign courts and times below.</p>
                  </div>
                )}

                {selectedCategory.status === "REGISTRATION_OPEN" && (
                  <div className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-muted-foreground">
                     At least two confirmed entries are required before registration can close. A draw preview cannot be generated while registration is open.
                   </div>
                )}
              </CardContent>
            </Card>}

            {knockoutAvailable && knockoutWorkspaceVisible && (
              <Card className="border-slate-200 shadow-sm">
                <CardHeader className="border-b bg-slate-50/70">
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Trophy className="size-5 text-amber-600" aria-hidden="true" />
                    Knockout bracket
                  </CardTitle>
                  <CardDescription>
                    Review the actual entry count, random byes and progression before creating matches.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-5 p-5">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <Badge variant="outline">{isDirectElimination ? "Single elimination" : `${selectedCategory.group_count} groups`}</Badge>
                    {!isDirectElimination && <Badge variant="outline">{selectedCategory.qualifiers_per_group} qualifier(s) per group</Badge>}
                    <Badge variant="outline">{isDirectElimination ? confirmedRegistrations.length : selectedCategory.group_count * selectedCategory.qualifiers_per_group} bracket entries</Badge>
                  </div>

                  {!isDirectElimination && selectedCategory.group_count * selectedCategory.qualifiers_per_group < 2 && (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
                      <p>An elimination bracket needs at least two qualifiers. Increase the qualifiers per group if only one group is available.</p>
                      {['DRAFT', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'DRAW_PREPARATION'].includes(selectedCategory.status) && (
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <label htmlFor={`qualifier-count-${selectedCategory.id}`} className="text-xs font-semibold">Qualifiers per group</label>
                          <Input
                            key={selectedCategory.id}
                            id={`qualifier-count-${selectedCategory.id}`}
                            type="number"
                            min={1}
                            defaultValue={selectedCategory.qualifiers_per_group}
                            className="h-10 w-24"
                          />
                          <Button variant="outline" className="min-h-10" onClick={() => void handleQualifierCountUpdate()} disabled={action !== null}>
                            Save
                          </Button>
                        </div>
                      )}
                    </div>
                  )}

                  {!isDirectElimination && !groupStageComplete ? (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
                      <p className="font-semibold">Group stage in progress</p>
                      <p className="mt-1">The proposal becomes available after every group match has a final result.</p>
                    </div>
                  ) : !knockoutPreview ? (
                    <div className="rounded-xl border border-dashed border-slate-300 p-4">
                      <p className="font-semibold text-slate-900">Ready for bracket review</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {isDirectElimination ? "All confirmed entries enter this bracket after registration closes." : "Qualifiers are ordered as group winners, then runners-up."} Bracket size and random byes follow the actual entry count.
                      </p>
                      <Button className="mt-4 min-h-11" onClick={() => void handlePrepareKnockout()} disabled={action !== null || isTerminalTournament || (isDirectElimination ? !["REGISTRATION_CLOSED","DRAW_PREPARATION","DRAW_GENERATED"].includes(selectedCategory.status) || confirmedRegistrations.length < 2 : selectedCategory.group_count * selectedCategory.qualifiers_per_group < 2)}>
                        <Sparkles className="size-4" aria-hidden="true" />
                        Prepare knockout proposal
                      </Button>
                    </div>
                  ) : (
                    <>
                      <KnockoutBracket
                        bracket={knockoutPreview.bracket}
                        matches={knockoutMatches}
                        title={knockoutPreview.status === "READY" ? "Proposed knockout bracket" : "Official knockout bracket"}
                      />
                      {knockoutPreview.status === "READY" ? (
                        <div className="flex flex-col gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <p className="font-semibold text-blue-950">Administrator review required</p>
                            <p className="mt-1 text-sm text-blue-900">Publishing advances byes automatically and creates matches only between two real entries. Later rounds follow confirmed winners.</p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                          {isDirectElimination && <Button variant="outline" className="min-h-11" onClick={() => void handlePrepareKnockout()} disabled={action !== null || isTerminalTournament}>Regenerate proposal</Button>}
                          {isDirectElimination && <Button variant="outline" className="min-h-11" onClick={() => setCancelOpen(true)} disabled={action !== null || isTerminalTournament}>Cancel preview</Button>}
                          <Button className="min-h-11 shrink-0" onClick={() => void handlePublishKnockout()} disabled={action !== null || isTerminalTournament}>
                            <BadgeCheck className="size-4" aria-hidden="true" />
                            Publish bracket
                          </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
                          Official bracket published. Winners advance automatically after each knockout result is signed off.
                        </div>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>
            )}
          </div>

          <Card id="match-schedule" className="scroll-mt-6 border-slate-200 shadow-sm">
            <CardHeader className="border-b bg-slate-50/70">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2 text-lg"><CalendarDays className="size-5 text-emerald-700" aria-hidden="true" />Schedule and officials</CardTitle>
                  <CardDescription>Untimed matches stay TBA, including new knockout rounds. MT can set their time when ready. Every save checks court, player and official conflicts.</CardDescription>
                </div>
                {scheduleWorkspaceVisible && (
                  <div className="flex gap-2 text-xs font-semibold">
                    <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-900">{matches.filter((match) => !match.scheduled_time).length} unscheduled</Badge>
                    <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-800">{matches.filter((match) => match.scheduled_time).length} scheduled</Badge>
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {!scheduleWorkspaceVisible ? (
                <div className="px-6 py-12 text-center text-sm text-muted-foreground">Publish the draw before assigning courts, times, or officials.</div>
              ) : loading ? (
                <div className="flex min-h-40 items-center justify-center gap-3 text-sm text-muted-foreground"><RefreshCw className="size-4 animate-spin" aria-hidden="true" />Loading matches…</div>
              ) : matches.length === 0 ? (
                <div className="px-6 py-12 text-center text-sm text-muted-foreground">No matches were generated for this category.</div>
              ) : (
                <div className="divide-y">
                  {matches.map((match) => {
                    const canEdit =
                      !isTerminalTournament &&
                      [
                        "DRAW_PUBLISHED",
                        "GROUP_STAGE_IN_PROGRESS",
                        "GROUP_STAGE_COMPLETED",
                        "KNOCKOUT_IN_PROGRESS",
                      ].includes(selectedCategory.status) &&
                      match.status === "SCHEDULED"
                    return (
                      <div key={match.id} className="grid gap-4 px-5 py-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-bold text-slate-900">{match.player_a_name ?? "Player A"} <span className="font-normal text-slate-400">vs</span> {match.player_b_name ?? "Player B"}</span>
                            <Badge variant="outline" className={match.scheduled_time ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-900"}>
                              {match.scheduled_time ? `Court ${match.court_number} · ${formatDateTime(match.scheduled_time)}` : "Time TBA"}
                            </Badge>
                            <Badge variant="outline">{getMatchStageLabel(match)}</Badge>
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">Match status: {statusLabel(match.status)}</p>
                        </div>
                        <div className="flex flex-col gap-3 lg:items-end">
                          {canEdit && (
                            <div className="flex flex-wrap gap-2">
                              <Button variant={match.scheduled_time ? "outline" : "default"} className="min-h-11" onClick={() => setScheduleMatchId(match.id)}>
                                <CalendarDays className="size-4" aria-hidden="true" />
                                {match.scheduled_time ? "Edit match time" : "Set match time"}
                              </Button>
                              <Link href={`/umpire/court/${match.id}`} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 transition hover:border-blue-300 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                                <UserCheck className="size-4" aria-hidden="true" />
                                Scoring console
                              </Link>
                            </div>
                          )}
                          <MatchOfficialAssignmentLink matchId={match.id} canAssign={canEdit} status={match.status} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950">
            <ShieldCheck className="mt-0.5 size-5 shrink-0 text-blue-700" aria-hidden="true" />
            <p className="leading-6"><span className="font-semibold">Operational rule:</span> committee changes are checked on the server and recorded in the audit trail. The browser never becomes the source of truth for permissions, capacity, draw publication, or scheduling.</p>
          </div>
        </section>
      )}

      <Dialog open={completeOpen} onOpenChange={setCompleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Complete this tournament?</DialogTitle>
            <DialogDescription>Completion is allowed only after every published match has a final result. The action is recorded in the audit trail.</DialogDescription>
          </DialogHeader>
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
            <p className="font-semibold">Finalization checklist</p>
            <ul className="mt-2 list-inside list-disc space-y-1">
              <li>Every category has a published draw.</li>
              <li>Every match is Completed, Walkover, or Retired.</li>
              <li>No court allocation is still in an active state.</li>
            </ul>
          </div>
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Button variant="outline" className="min-h-11" onClick={() => setCompleteOpen(false)} disabled={action !== null}>Keep open</Button>
            <Button className="min-h-11" onClick={() => void handleCompleteTournament()} disabled={action !== null}>{action === "complete" ? "Completing…" : "Complete tournament"}</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={archiveOpen} onOpenChange={setArchiveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Archive this completed tournament?</DialogTitle>
            <DialogDescription>Archiving retains the event, categories, results, and audit history while removing it from active committee work.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Button variant="outline" className="min-h-11" onClick={() => setArchiveOpen(false)} disabled={action !== null}>Cancel</Button>
            <Button variant="destructive" className="min-h-11" onClick={() => void handleArchiveTournament()} disabled={action !== null}>{action === "archive" ? "Archiving…" : "Archive tournament"}</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={publishOpen} onOpenChange={setPublishOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Publish this official draw?</DialogTitle>
            <DialogDescription>
              This locks the group composition, creates the round-robin matches, and makes the draw visible to players. It cannot be undone from this workspace.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
            <p className="font-semibold">Before you publish</p>
            <ul className="mt-2 list-inside list-disc space-y-1">
              <li>Every confirmed player appears exactly once.</li>
              <li>Seeded players are distributed before unseeded players.</li>
              <li>Matches will be created without a court or time; schedule them next.</li>
            </ul>
          </div>
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Button variant="outline" className="min-h-11" onClick={() => setPublishOpen(false)} disabled={action !== null}>Keep preview</Button>
            <Button className="min-h-11" onClick={() => void handlePublish()} disabled={action !== null}>{action?.startsWith("publish") ? "Publishing…" : "Publish official draw"}</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Discard this preview?</DialogTitle>
            <DialogDescription>The private preview will be removed and the category will return to registration-closed preparation. No player groups or matches have been created yet.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Button variant="outline" className="min-h-11" onClick={() => setCancelOpen(false)} disabled={action !== null}>Keep preview</Button>
            <Button variant="destructive" className="min-h-11" onClick={() => void handleCancelPreview()} disabled={action !== null}><RotateCcw className="size-4" aria-hidden="true" />Discard preview</Button>
          </div>
        </DialogContent>
      </Dialog>

      {scheduleTarget && canEditMatchSchedule({...scheduleTarget,category_status:selectedCategory?.status,tournament_status:initialTournament.status}) && (
        <MatchScheduleDialog
          key={`${scheduleTarget.id}-${scheduleTarget.court_number ?? "none"}-${scheduleTarget.scheduled_time ?? "none"}`}
          open={scheduleMatchId !== null}
          onOpenChange={(open) => !open && setScheduleMatchId(null)}
          match={scheduleTarget}
          allMatches={matches}
          tournament={{
            courtCount: initialTournament.court_count,
            startDate: initialTournament.start_date,
            endDate: initialTournament.end_date,
          }}
          profiles={initialProfiles}
          onScheduled={() =>
            selectedCategory
              ? loadCategoryData(selectedCategory.id)
              : Promise.resolve()
          }
        />
      )}
    </div>
  )

  async function handleStatusForCategory(categoryId: string, status: "REGISTRATION_OPEN" | "REGISTRATION_CLOSED") {
    if (categoryId !== selectedCategoryId) selectCategory(categoryId)
    setAction(`status:${categoryId}`)
    try {
      const result = await updateCategoryStatus(categoryId, status)
      if (!result.success) {
        showActionError("Registration status not changed", result.error.message)
        return
      }
      toast.add({ title: status === "REGISTRATION_OPEN" ? "Registration opened" : "Registration closed", type: "success" })
      await refreshCategories()
      if (categoryId === selectedCategoryId) await loadCategoryData(categoryId)
    } finally {
      setAction(null)
    }
  }
}
