import type { FeatureAvailability } from "@/app/actions/setup"

export default function DatabaseSetupNotice({ features }: { features: FeatureAvailability }) {
  if (features.knockout && features.doubles && features.league && features.organization && features.tournamentRoles && features.dynamicDraws && features.liveScores) return null
  return <aside role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
    <h2 className="font-bold">Database setup is incomplete</h2>
    <p className="mt-1">Existing tournaments remain available. {!features.knockout ? "Knockout brackets need the bracket database update. " : ""}{!features.doubles ? "Doubles registration and squad management need the doubles database update. " : ""}{!features.league ? "The new league standings need the league database update. " : ""}{!features.organization ? "MT, EXCO and AJK approval needs the organizational-role database update." : ""}</p>
    <details className="mt-2">
      <summary className="min-h-11 cursor-pointer py-2 font-semibold">Setup instructions for the project owner</summary>
      <p>Open the Supabase SQL Editor and run these project migration files in order, after the earlier migrations:</p>
      <ol className="mt-2 list-inside list-decimal space-y-1 break-all">
        {!features.knockout && <li><code>20260926120000_knockout_bracket.sql</code></li>}
        {!features.doubles && <li><code>20261105085640_doubles_pairing_and_squad_rules.sql</code></li>}
        {!features.league && <li><code>20261105093718_league_standings.sql</code></li>}
        {!features.organization && <li><code>20261106184015_organizational_role_approvals.sql</code></li>}
        {!features.tournamentRoles && <li><code>20261108162756_tournament_ajk_applications.sql</code></li>}
        {!features.dynamicDraws && <li><code>20261108164632_dynamic_draws_and_byes.sql</code></li>}
        {!features.liveScores && <li><code>20261108172058_realtime_match_scores.sql</code></li>}
      </ol>
      <p className="mt-2">Then refresh this page. These files are in the project&apos;s supabase/migrations folder.</p>
    </details>
  </aside>
}
