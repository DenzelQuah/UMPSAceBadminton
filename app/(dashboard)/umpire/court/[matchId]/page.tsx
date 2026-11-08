import { notFound, redirect } from "next/navigation"

import { getMatchForOperator } from "@/app/actions/matchOperations"
import { getCurrentUserWithRoles } from "@/app/actions/user"
import ScoringConsole from "./ScoringConsole"

interface MatchPageProps {
  params: Promise<{ matchId: string }>
}

export default async function MatchScoringPage({ params }: MatchPageProps) {
  const { matchId } = await params
  const [result, user] = await Promise.all([
    getMatchForOperator(matchId),
    getCurrentUserWithRoles(),
  ])

  if (!user) redirect("/login")
  if (!result.success) {
    if (result.error.status === 403) redirect("/umpire")
    notFound()
  }

  return (
    <ScoringConsole
      matchId={matchId}
      initialData={result.data}
      isAdmin={user.roles.isOrganizer}
    />
  )
}
