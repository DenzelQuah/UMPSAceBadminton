import { canApplyForCommitteeRoles,canAssignMatchOfficials } from "@/lib/auth/organizational-roles";
import TournamentDetailsClient from './TournamentDetailsClient';
import { getTournament } from '@/app/actions/tournaments';
import { getCategories } from '@/app/actions/categories';
import { getPlayerRegistrations } from '@/app/actions/registrations';
import { getCategoryMatches } from '@/app/actions/matches';
import { getKnockoutPreview, type KnockoutPreview } from '@/app/actions/knockout';
import { notFound } from 'next/navigation';
import { getMyAjkApplications } from '@/app/actions/tournament-roles';
import { getCurrentUserWithRoles } from '@/app/actions/user';
import TournamentAjkApplication from '@/components/TournamentAjkApplication';
import { getGroupPreview } from '@/app/actions/live-scores';

interface TournamentDetailsPageProps {
  params: Promise<{
    tournamentId: string;
  }>;
}

const TournamentDetailsPage = async ({ params }: TournamentDetailsPageProps) => {
  const { tournamentId } = await params;
  const user=await getCurrentUserWithRoles();
  const canApply=canApplyForCommitteeRoles(user?.profile);

  // Fetch all data in parallel on the server
  const [tournamentRes, categoriesRes, registrationsRes, applications] = await Promise.all([
    getTournament(tournamentId),
    getCategories(tournamentId),
    getPlayerRegistrations(),
    canApply ? getMyAjkApplications() : null,
  ]);

  if (!tournamentRes.success || !tournamentRes.data) {
    notFound();
  }

  const categories = categoriesRes.success ? (categoriesRes.data ?? []) : [];
  const [knockoutPreviews, categoryMatches, groupPreview] = await Promise.all([
    Promise.all(categories.map(async (category) => {
      const result = await getKnockoutPreview(category.id);
      return [category.id, result.success ? result.data : null] as const;
    })),
    Promise.all(categories.map(async (category) => {
      const result = await getCategoryMatches(category.id);
      return [category.id, result.success ? result.data : []] as const;
    })),
    getGroupPreview(categories.map((category)=>category.id)),
  ]);

  return (
    <div className="space-y-6">
    <TournamentDetailsClient
      tournamentId={tournamentId}
      canAssignOfficials={canAssignMatchOfficials(user?.profile)}
      managementTournamentId={user?.roles.isOrganizer ? tournamentId : undefined}
      initialTournament={tournamentRes.data}
      initialCategories={categories}
      initialUserRegistrations={registrationsRes.success ? (registrationsRes.data ?? []) : []}
      initialKnockoutPreviews={Object.fromEntries(knockoutPreviews) as Record<string, KnockoutPreview | null>}
      initialCategoryMatches={Object.fromEntries(categoryMatches)}
      initialGroups={groupPreview.success ? groupPreview.data.groups : []}
      initialScores={groupPreview.success ? groupPreview.data.scores : []}
      groupPreviewError={!groupPreview.success ? groupPreview.error.message : undefined}
    />
    {canApply && <TournamentAjkApplication tournaments={[tournamentRes.data]} applications={applications?.success ? applications.data : []} approvedTournamentIds={user?.profile?.tournament_ajk_ids} globalAjk={user?.profile?.organizational_role === 'AJK'} loadError={applications && !applications.success ? applications.error.message : undefined} />}
    </div>
  );
};

export default TournamentDetailsPage;
