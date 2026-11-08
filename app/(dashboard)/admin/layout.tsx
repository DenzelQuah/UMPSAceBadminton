import { redirect } from "next/navigation"

import { getCurrentUserWithRoles } from "@/app/actions/user"

export default async function CommitteeLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await getCurrentUserWithRoles()
  if (!user?.roles.isOrganizer) {
    redirect("/dashboard?error=unauthorized_admin")
  }

  return children
}
