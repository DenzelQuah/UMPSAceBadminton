import { redirect } from "next/navigation"
import { getCurrentUserWithRoles } from "@/app/actions/user"
import WorkspaceShell from "@/components/WorkspaceShell"

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUserWithRoles()
  if (!user) redirect("/login")
  return <WorkspaceShell userProfile={user}>{children}</WorkspaceShell>
}
