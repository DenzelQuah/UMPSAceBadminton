"use client"

import { CircleAlert, RefreshCw } from "lucide-react"

import { Button } from "@/components/ui/button"
import Link from "next/link"

export default function DashboardError({
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center text-center" role="alert">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-red-50 text-red-700">
        <CircleAlert className="size-7" aria-hidden="true" />
      </div>
      <h1 className="mt-5 text-xl font-bold text-slate-950">This workspace could not load</h1>
      <p className="mt-2 text-sm leading-6 text-slate-600">We could not load this workspace. Try again, or return to your dashboard and check any setup notices.</p>
      <Button className="mt-6 min-h-11 gap-2" onClick={() => reset()}>
        <RefreshCw className="size-4" aria-hidden="true" />
        Try again
      </Button>
      <Link href="/dashboard" className="mt-3 inline-flex min-h-11 items-center rounded-lg px-4 text-sm font-semibold text-primary underline">Return to dashboard</Link>
    </div>
  )
}
