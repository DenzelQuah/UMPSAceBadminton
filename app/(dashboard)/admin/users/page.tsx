import { redirect } from "next/navigation"
import { getCurrentUserWithRoles } from "@/app/actions/user"
import { getOrganizationApprovals } from "@/app/actions/organization"
import OrganizationApprovals from "@/components/OrganizationApprovals"
import AutoRefresh from "@/components/AutoRefresh"

export default async function RoleApprovalsPage() {
  const user = await getCurrentUserWithRoles()
  if (!user?.roles.isPlatformAdmin) redirect("/dashboard?error=approval_admin_required")
  const result = await getOrganizationApprovals()
  return <div className="mx-auto max-w-5xl space-y-6"><AutoRefresh intervalMs={10000} /><header><h1 className="text-3xl font-bold text-primary">Organization role approvals</h1><p className="mt-2 text-sm text-muted-foreground">Approve MT, EXCO and AJK requests. MT members manage tournaments; EXCO and AJK members receive match duties.</p></header>{result.success ? <OrganizationApprovals requests={result.data.requests} members={result.data.members} /> : <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-950">{result.error.message}</p>}</div>
}
