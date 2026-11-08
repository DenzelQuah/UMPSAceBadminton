"use client"

import { useRouter } from "next/navigation"
import * as React from "react"

/**
 * Refreshes a server-rendered workspace while the tab is visible.
 * Live scoring views use this to pick up points recorded in another console.
 */
export default function AutoRefresh({
  intervalMs = 5000,
}: {
  intervalMs?: number
}) {
  const router = useRouter()

  React.useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") {
        router.refresh()
      }
    }

    const timer = window.setInterval(refresh, intervalMs)
    window.addEventListener("focus", refresh)
    document.addEventListener("visibilitychange", refresh)

    return () => {
      window.clearInterval(timer)
      window.removeEventListener("focus", refresh)
      document.removeEventListener("visibilitychange", refresh)
    }
  }, [intervalMs, router])

  return null
}
