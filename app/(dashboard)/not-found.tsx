import Link from "next/link"
import { ArrowLeft, SearchX } from "lucide-react"

import { Button } from "@/components/ui/button"

export default function DashboardNotFound() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-blue-50 text-blue-700">
        <SearchX className="size-7" aria-hidden="true" />
      </div>
      <h1 className="mt-5 text-xl font-bold text-slate-950">That page is not available</h1>
      <p className="mt-2 text-sm leading-6 text-slate-600">The tournament, match, or workspace may have moved or may not be assigned to your account.</p>
      <Button nativeButton={false} render={<Link href="/dashboard" />} className="mt-6 min-h-11 gap-2">
        <ArrowLeft className="size-4" aria-hidden="true" />
        Return to overview
      </Button>
    </div>
  )
}
