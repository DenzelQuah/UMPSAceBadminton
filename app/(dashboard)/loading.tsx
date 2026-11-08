export default function DashboardLoading() {
  return (
    <div className="mx-auto w-full max-w-6xl animate-pulse space-y-6" role="status" aria-live="polite">
      <div className="h-44 rounded-2xl bg-slate-200" />
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="h-28 rounded-xl bg-slate-200" />
        <div className="h-28 rounded-xl bg-slate-200" />
        <div className="h-28 rounded-xl bg-slate-200" />
      </div>
      <div className="h-72 rounded-2xl bg-slate-200" />
      <span className="sr-only">Loading your workspace</span>
    </div>
  )
}
