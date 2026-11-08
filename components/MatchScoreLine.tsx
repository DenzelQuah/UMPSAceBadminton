"use client"

import { memo } from "react"
import type { LiveScore } from "@/lib/realtime/live-scores"

export default memo(function MatchScoreLine({score}:{score?:LiveScore}) {
  if(!score)return <p className="text-xs text-muted-foreground">Waiting for live score</p>
  return <div className="flex flex-wrap gap-2" aria-live="polite" aria-atomic="true">
    {score.games.length ? score.games.map((g)=><span key={g.gameNumber} className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-bold tabular-nums"><span className="mr-2 text-xs font-normal text-slate-600">Game {g.gameNumber}</span>{g.playerAScore} – {g.playerBScore}</span>) : <span className="text-sm font-bold tabular-nums">0 – 0</span>}
  </div>
})
