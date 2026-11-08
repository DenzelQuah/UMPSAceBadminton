import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"

export default async function HomePage() {
  const supabase = await createClient()
  const { data: claimsData } = await supabase.auth.getClaims()

  if (!claimsData?.claims?.sub) {
    redirect("/login")
  }

  redirect("/dashboard")
}
