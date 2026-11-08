import { notFound, redirect } from "next/navigation"

import { getAllProfiles } from "@/app/actions/officials"
import { getCategories, getCategoryRegistrations } from "@/app/actions/categories"
import { getCurrentUserWithRoles } from "@/app/actions/user"
import { getCategoryMatches } from "@/app/actions/matches"
import { getCategoryDrawPreview, getTournament } from "@/app/actions/tournaments"
import TournamentAdminClient from "./TournamentAdminClient"
import { getTournamentFeatureStatus } from "@/app/actions/setup"
import DatabaseSetupNotice from "@/components/DatabaseSetupNotice"

interface TournamentAdminPageProps {
  searchParams: Promise<{category?:string | string[];schedule?:string | string[]}>
  params: Promise<{
    tournamentId: string
  }>
}

export default async function TournamentAdminPage({
  params,
  searchParams,
}: TournamentAdminPageProps) {
  const { tournamentId } = await params
  const user = await getCurrentUserWithRoles()

  if (!user?.roles.isOrganizer) {
    redirect("/dashboard?error=unauthorized_admin")
  }

  const [tournamentResult, categoriesResult, profilesResult, featuresResult] = await Promise.all([
    getTournament(tournamentId),
    getCategories(tournamentId),
    getAllProfiles(tournamentId),
    getTournamentFeatureStatus(),
  ])

  if (!tournamentResult.success) notFound()

  const query=await searchParams
  const initialCategoryId = categoriesResult.success
    ? (categoriesResult.data.find((category)=>category.id===query.category) ?? categoriesResult.data[0])?.id
    : undefined
  const [registrationsResult, matchesResult, previewResult] = initialCategoryId
    ? await Promise.all([
        getCategoryRegistrations(initialCategoryId),
        getCategoryMatches(initialCategoryId),
        getCategoryDrawPreview(initialCategoryId),
      ])
    : [null, null, null]

  const initialScheduleMatchId=typeof query.schedule==="string" && matchesResult?.success && matchesResult.data.some((match)=>match.id===query.schedule)
    ? query.schedule : null

  return (
    <div className="space-y-5">
      {featuresResult.success && <DatabaseSetupNotice features={featuresResult.data} />}
      <TournamentAdminClient
      key={`${tournamentId}-${initialCategoryId ?? "none"}-${initialScheduleMatchId ?? "none"}`}
      initialCategoryId={initialCategoryId}
      initialScheduleMatchId={initialScheduleMatchId}
      doublesAvailable={featuresResult.success && featuresResult.data.doubles}
      knockoutAvailable={featuresResult.success && featuresResult.data.knockout}
      tournamentId={tournamentId}
      initialTournament={tournamentResult.data}
      initialCategories={categoriesResult.success ? categoriesResult.data : []}
      initialProfiles={profilesResult.success ? profilesResult.data : []}
      initialRegistrations={
        registrationsResult?.success ? registrationsResult.data : []
      }
      initialMatches={matchesResult?.success ? matchesResult.data : []}
      initialPreview={previewResult?.success ? previewResult.data : null}
      />
    </div>
  )
}
