import { getVisibleTournaments } from "@/app/actions/tournaments"
import { getCurrentUserWithRoles } from "@/app/actions/user"
import TournamentDirectory from "@/components/TournamentDirectory"

export default async function TournamentsPage() {
  const [result, user] = await Promise.all([getVisibleTournaments(), getCurrentUserWithRoles()])
  return <TournamentDirectory tournaments={result.success ? result.data : []} canManage={user?.roles.isOrganizer === true} error={result.success ? undefined : result.error.message} />
}
