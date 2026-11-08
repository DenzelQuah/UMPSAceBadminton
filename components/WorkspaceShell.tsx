"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import {
  LayoutDashboard,
  CalendarDays,
  LogOut,
  Menu,
  ShieldCheck,
  Trophy,
  User,
  UserCheck,
  X,
} from "lucide-react"

import { signOutUser } from "@/app/actions/auth"
import type { UserRoleProfile } from "@/app/actions/user"
import { Button } from "@/components/ui/button"
import { toast } from "@/components/ui/toast"
import { cn } from "@/lib/utils"
import { ROLE_LABELS, displayName,approvedRole } from "@/lib/auth/organizational-roles"

export default function WorkspaceShell({ children, userProfile }: { children: React.ReactNode; userProfile: UserRoleProfile }) {
  const pathname = usePathname()
  const router = useRouter()
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false)
  const menuButtonRef = React.useRef<HTMLButtonElement>(null)
  const closeButtonRef = React.useRef<HTMLButtonElement>(null)
  const mobileMenuWasOpen = React.useRef(false)

  React.useEffect(() => {
    const error = new URLSearchParams(window.location.search).get("error")
    if (!error) return
    if (error === "unauthorized_admin") {
      toast.add({
        title: "Committee access required",
        description: "Tournament management requires approved MT or administrator access.",
        type: "error",
      })
    } else if (error === "unauthorized_official_assignment") {
      toast.add({title:"Match assignment access required",description:"Only approved MT, EXCO and administrators can assign match officials.",type:"error"})
    } else if (error === "unauthorized_umpire") {
      toast.add({
        title: "Official assignment required",
        description: "This court is assigned to another umpire.",
        type: "error",
      })
    }
  }, [])

  React.useEffect(() => {
    if (!mobileMenuOpen) return
    closeButtonRef.current?.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileMenuOpen(false)
    }
    document.addEventListener("keydown", handleKeyDown)
    document.body.style.overflow = "hidden"
    return () => {
      document.removeEventListener("keydown", handleKeyDown)
      document.body.style.overflow = ""
    }
  }, [mobileMenuOpen])

  React.useEffect(() => {
    if (mobileMenuWasOpen.current && !mobileMenuOpen) {
      menuButtonRef.current?.focus()
    }
    mobileMenuWasOpen.current = mobileMenuOpen
  }, [mobileMenuOpen])

  const handleLogout = async () => {
    const response = await signOutUser()
    if (!response.success) {
      toast.add({
        title: "Sign out failed",
        description: response.error.message,
        type: "error",
      })
      return
    }
    toast.add({ title: "Signed out", type: "success" })
    router.replace("/login")
    router.refresh()
  }

  const navItems = React.useMemo(() => {
    if (!userProfile) return []
    const items = [
      { name: "Choose workspace", href: "/dashboard", icon: LayoutDashboard },
      { name: "Tournaments", href: "/tournaments", icon: Trophy },
    ]
    if (userProfile.roles.isOrganizer) {
      items.push(
        { name: "MT Dashboard", href: "/mt", icon: ShieldCheck },
        { name: "Tournament management", href: "/admin", icon: Trophy },
        // Administrators can open any published scoring console, including
        // after navigating away from an operator session.
        { name: "Scoring console", href: "/umpire", icon: UserCheck }
      )
    }
    if (userProfile.roles.isPlatformAdmin) items.push({ name: "Role approvals", href: "/admin/users", icon: ShieldCheck })
    if (!userProfile.roles.isOrganizer && userProfile.roles.isOfficial) {
      items.push({ name: "Committee duties", href: "/umpire", icon: UserCheck })
    }
    if (userProfile.roles.isPlayer) {
      items.push(
        { name: "Draw / Schedule", href: "/matches", icon: CalendarDays },
        { name: "Leaderboard", href: "/rankings", icon: Trophy }
      )
    }
    return items
  }, [userProfile])

  const navigation = (
    <nav className="space-y-1.5" aria-label="Primary navigation">
      {navItems.map((item) => {
        const isActive =
          pathname === item.href ||
          (item.href !== "/dashboard" && pathname.startsWith(`${item.href}/`))
        const Icon = item.icon
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setMobileMenuOpen(false)}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "flex min-h-12 items-center gap-3 rounded-xl px-3.5 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80",
              isActive
                ? "bg-white text-primary shadow-sm"
                : "text-blue-100 hover:bg-white/10 hover:text-white"
            )}
          >
            <Icon className="size-5 shrink-0" aria-hidden="true" />
            <span>{item.name}</span>
          </Link>
        )
      })}
    </nav>
  )

  const profile = userProfile?.profile
  const currentRole=approvedRole(profile)
  const roleLabel = currentRole==="SYSTEM_ADMIN"
    ? "Platform administrator"
    : currentRole === "AJK" ? "AJK · Tournament committee"
    : ROLE_LABELS[currentRole]

  return (
    <div className="min-h-screen bg-slate-50">
      <a
        href="#main-content"
        className="fixed left-3 top-3 z-[100] -translate-y-20 rounded-lg bg-white px-4 py-3 font-semibold text-primary shadow-lg transition focus:translate-y-0 focus:outline-none focus:ring-2 focus:ring-ring"
      >
        Skip to main content
      </a>

      <aside className="fixed inset-y-0 left-0 z-30 hidden w-72 flex-col bg-primary text-primary-foreground md:flex">
        <div className="flex h-full flex-col p-5">
          <Link
            href="/dashboard"
            className="mb-8 flex min-h-12 items-center gap-3 rounded-xl px-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
          >
            <span className="flex size-10 items-center justify-center rounded-xl bg-secondary text-secondary-foreground">
              <Trophy className="size-5" aria-hidden="true" />
            </span>
            <span>
              <span className="block text-base font-bold">UMPSAce</span>
              <span className="block text-xs text-blue-200">Badminton Operations</span>
            </span>
          </Link>

          {navigation}

          <div className="mt-auto space-y-4 border-t border-white/15 pt-5">
            {profile && (
              <div className="flex items-center gap-3 rounded-xl bg-white/10 p-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-white text-primary">
                  <User className="size-5" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{displayName(profile.full_name,profile.user_role)}</p>
                  <p className="truncate text-xs text-blue-200">{roleLabel}</p>
                </div>
              </div>
            )}
            <Button
              variant="ghost"
              onClick={() => void handleLogout()}
              className="min-h-12 w-full justify-start gap-3 px-3 text-blue-100 hover:bg-white/10 hover:text-white"
            >
              <LogOut className="size-5" aria-hidden="true" />
              Sign out
            </Button>
          </div>
        </div>
      </aside>

      <div className="md:pl-72">
        <header className="sticky top-0 z-20 flex min-h-16 items-center justify-between border-b border-slate-200 bg-white/95 px-4 backdrop-blur md:hidden">
          <Link href="/dashboard" className="flex items-center gap-2 font-bold text-primary">
            <Trophy className="size-5" aria-hidden="true" />
            UMPSAce
          </Link>
          <Button
            ref={menuButtonRef}
            variant="outline"
            size="icon"
            className="size-12"
            onClick={() => setMobileMenuOpen(true)}
            aria-label="Open navigation menu"
            aria-expanded={mobileMenuOpen}
            aria-controls="mobile-navigation"
          >
            <Menu className="size-6" aria-hidden="true" />
          </Button>
        </header>

        {mobileMenuOpen && (
          <div className="fixed inset-0 z-50 md:hidden">
            <button
              type="button"
              className="absolute inset-0 cursor-default bg-slate-950/55 backdrop-blur-sm"
              aria-label="Close navigation menu"
              onClick={() => setMobileMenuOpen(false)}
            />
            <div
              id="mobile-navigation"
              role="dialog"
              aria-modal="true"
              aria-label="Navigation menu"
              className="relative flex h-full w-[min(88vw,22rem)] flex-col bg-primary p-5 text-white shadow-2xl"
            >
              <div className="mb-7 flex items-center justify-between">
                <span className="flex items-center gap-2 font-bold">
                  <Trophy className="size-5" aria-hidden="true" /> UMPSAce
                </span>
                <Button
                  ref={closeButtonRef}
                  variant="ghost"
                  size="icon"
                  className="size-12 text-white hover:bg-white/10 hover:text-white"
                  onClick={() => setMobileMenuOpen(false)}
                  aria-label="Close navigation menu"
                >
                  <X className="size-6" aria-hidden="true" />
                </Button>
              </div>
              {navigation}
              <div className="mt-auto border-t border-white/15 pt-5">
                {profile && (
                  <div className="mb-4 rounded-xl bg-white/10 p-3">
                    <p className="truncate text-sm font-semibold">{displayName(profile.full_name,profile.user_role)}</p>
                    <p className="truncate text-xs text-blue-200">{roleLabel}</p>
                  </div>
                )}
                <Button
                  variant="ghost"
                  onClick={() => void handleLogout()}
                  className="min-h-12 w-full justify-start gap-3 text-blue-100 hover:bg-white/10 hover:text-white"
                >
                  <LogOut className="size-5" aria-hidden="true" /> Sign out
                </Button>
              </div>
            </div>
          </div>
        )}

        <main id="main-content" tabIndex={-1} className="min-h-screen p-4 outline-none sm:p-6 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  )
}
