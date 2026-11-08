import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"
import { readActorProfile } from "@/lib/auth/actor-profile"
import { canManageTournaments, isApprovedStaff } from "@/lib/auth/organizational-roles"

function copySupabaseCookies(
  source: NextResponse,
  destination: NextResponse
): NextResponse {
  source.cookies.getAll().forEach((cookie) => destination.cookies.set(cookie))
  for (const headerName of ["cache-control", "expires", "pragma"]) {
    const value = source.headers.get(headerName)
    if (value) destination.headers.set(headerName, value)
  }
  return destination
}

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet, headersToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
          Object.entries(headersToSet).forEach(([name, value]) => {
            if (value) supabaseResponse.headers.set(name, value)
          })
        },
      },
    }
  )

  const { data: claimsData } = await supabase.auth.getClaims()
  const userId = claimsData?.claims?.sub ?? null
  const url = request.nextUrl.clone()
  const isDashboardRoute =
    url.pathname === "/dashboard" ||
    url.pathname.startsWith("/tournaments") ||
    url.pathname.startsWith("/matches") ||
    url.pathname.startsWith("/rankings")
  const isAdminRoute = url.pathname.startsWith("/admin") || url.pathname === "/mt" || url.pathname.startsWith("/mt/")
  const isUmpireRoute = url.pathname.startsWith("/umpire")

  if (!userId && (isDashboardRoute || isAdminRoute || isUmpireRoute)) {
    url.pathname = "/login"
    url.search = ""
    url.searchParams.set("redirect_to", `${request.nextUrl.pathname}${request.nextUrl.search}`)
    return copySupabaseCookies(supabaseResponse, NextResponse.redirect(url))
  }

  if (userId) {
    const { data: profile } = await readActorProfile(supabase)
    const isAdmin = canManageTournaments(profile)

    if (isAdminRoute && !isAdmin) {
      url.pathname = "/dashboard"
      url.search = ""
      url.searchParams.set("error", "unauthorized_admin")
      return copySupabaseCookies(supabaseResponse, NextResponse.redirect(url))
    }

    if (isUmpireRoute && url.pathname.startsWith("/umpire/court/")) {
      const matchId = url.pathname.split("/").pop()
      if (matchId && !isAdmin) {
        const { data: match } = await supabase
          .from("matches")
          .select("umpire_id")
          .eq("id", matchId)
          .maybeSingle()

        if (!match || match.umpire_id !== userId || (profile?.tournament_roles_available ? !profile.authorized_umpire_match_ids.includes(matchId) : profile?.role_model_available && !isApprovedStaff(profile))) {
          url.pathname = "/dashboard"
          url.search = ""
          url.searchParams.set("error", "unauthorized_umpire")
          return copySupabaseCookies(supabaseResponse, NextResponse.redirect(url))
        }
      }
    }
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
