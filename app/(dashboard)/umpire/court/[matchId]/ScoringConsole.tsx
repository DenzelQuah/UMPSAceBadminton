"use client"

import * as React from "react"
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  Clock3,
  LockKeyhole,
  Play,
  RotateCcw,
  ShieldAlert,
  Trophy,
  UserRound,
} from "lucide-react"
import Link from "next/link"

import {
  getMatchForOperator,
  logDisciplinaryCard,
  overrideMatchResult,
  adjustMatchPoint,
  startMatch,
  submitMatchResult,
  type MatchOperationData,
} from "@/app/actions/matchOperations"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { toast } from "@/components/ui/toast"
import { getMatchStageLabel } from "@/lib/tournament/stages"
import { useLiveScores } from "@/lib/realtime/use-live-scores"
import { withScoreTimeout,type PointCommand } from "@/lib/realtime/live-scores"
import {
  getBetweenGameIntervalSeconds,
  getCrossingIntervalSeconds,
  getGameState,
  getNextIncompleteGameNumber,
  hasReachedIntervalThreshold,
  isMatchComplete,
} from "@/lib/tournament/scoring"

interface ScoringConsoleProps {
  matchId: string
  initialData: MatchOperationData
  isAdmin: boolean
}

function gameLabel(gameNumber: number): string {
  return `Game ${gameNumber}`
}

export default function ScoringConsole({
  matchId,
  initialData,
  isAdmin,
}: ScoringConsoleProps) {
  const [data, setData] = React.useState(initialData)
  const [selectedGame, setSelectedGame] = React.useState(1)
  const [saving, setSaving] = React.useState(false)
  const [intervalSeconds, setIntervalSeconds] = React.useState(0)
  const [nextGameAfterInterval, setNextGameAfterInterval] = React.useState<number | null>(null)
  const betweenIntervalGamesRef = React.useRef<Set<number>>(new Set())
  const [overrideOpen, setOverrideOpen] = React.useState(false)
  const [overrideStatus, setOverrideStatus] = React.useState<"COMPLETED" | "WALKOVER" | "RETIRED" | "CANCELLED" | "POSTPONED">("COMPLETED")
  const [overrideWinner, setOverrideWinner] = React.useState<string>(initialData.match.winner_id ?? initialData.match.player_a_id)
  const [overrideReason, setOverrideReason] = React.useState("")
  const live=useLiveScores(initialData.match.category_id,undefined,matchId)
  const {isReady,resync,accept,disconnect,reconnect}=live
  const snapshot=live.scores[matchId]
  const matchStatus=snapshot?.status ?? data.match.status
  const connected=live.connection==="connected" && !!snapshot
  const pendingPoint=React.useRef<{command:PointCommand;previousA:number;previousB:number} | null>(null)
  const pointLocked=React.useRef(false),pointExecuting=React.useRef(false)
  const retryTimer=React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const retryDelay=React.useRef(2000),connectionToast=React.useRef<string | null>(null),wasConnected=React.useRef(false)
  // A game may cross its interval threshold only once. Seed this from the
  // server score so a refresh cannot restart an interval already reached.
  const intervalGamesRef = React.useRef<Set<number>>(
    new Set(
      initialData.games
        .filter((game) =>
          hasReachedIntervalThreshold(
            initialData.match.format,
            game.playerAScore,
            game.playerBScore
          )
        )
        .map((game) => game.gameNumber)
    )
  )

  const format = data.match.format
  const games = snapshot?.games ?? data.games
  const currentGame = games.find((game) => game.gameNumber === selectedGame) ?? {
    gameNumber: selectedGame,
    playerAScore: 0,
    playerBScore: 0,
  }
  const currentState = getGameState(format, currentGame.playerAScore, currentGame.playerBScore)
  const matchComplete = isMatchComplete(format, games)
  const completedGames = games.filter(
    (game) => getGameState(format, game.playerAScore, game.playerBScore) === "COMPLETED"
  )
  const playerAGameWins = completedGames.filter((game) => game.playerAScore > game.playerBScore).length
  const playerBGameWins = completedGames.filter((game) => game.playerBScore > game.playerAScore).length
  const liveWinner=snapshot ? snapshot.winner_id:data.match.winner_id
  const winnerName = liveWinner === data.match.player_a_id
    ? data.match.player_a_name ?? "Player A"
    : liveWinner === data.match.player_b_id
      ? data.match.player_b_name ?? "Player B"
      : null
  const locked = ["COMPLETED","WALKOVER","RETIRED","CANCELLED","POSTPONED"].includes(matchStatus)
  const canScore = connected && matchStatus === "IN_PROGRESS" && !locked && currentState !== "COMPLETED" && intervalSeconds === 0 && nextGameAfterInterval === null
  const canUndo=connected && matchStatus==="IN_PROGRESS" && !games.some((g)=>g.gameNumber>selectedGame && (g.playerAScore>0 || g.playerBScore>0))
  const canLogCard = connected && matchStatus === "IN_PROGRESS" && !locked && intervalSeconds === 0 && nextGameAfterInterval === null

  React.useEffect(() => {
    if (intervalSeconds <= 0) return
    const timer = window.setInterval(() => {
      setIntervalSeconds((current) => Math.max(0, current - 1))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [intervalSeconds])

  React.useEffect(() => {
    if (intervalSeconds > 0 || nextGameAfterInterval === null) return
    const readyTimeout = window.setTimeout(() => {
      setSelectedGame(nextGameAfterInterval)
      setNextGameAfterInterval(null)
      toast.add({
        title: `Game ${nextGameAfterInterval} ready`,
        description: "The rest interval is over. Scoring is now enabled.",
        type: "success",
      })
    }, 0)
    return () => window.clearTimeout(readyTimeout)
  }, [intervalSeconds, nextGameAfterInterval])

  React.useEffect(()=>{
    if(connected){
      wasConnected.current=true
      if(connectionToast.current){toast.close(connectionToast.current);connectionToast.current=null;toast.add({title:"Reconnected",description:"The saved score is synchronized.",type:"success"})}
    }else if((wasConnected.current || live.connection==="offline") && !connectionToast.current){
      connectionToast.current=toast.add({title:"Reconnecting...",description:"Point controls are paused until the saved score is synchronized.",type:"warning",timeout:0})
    }
  },[connected,live.connection])
  React.useEffect(()=>()=>{if(retryTimer.current)clearTimeout(retryTimer.current);if(connectionToast.current)toast.close(connectionToast.current)},[])

  const refresh = async () => {
    const response = await getMatchForOperator(matchId)
    if (response.success) setData(response.data)
    await live.resync()
  }

  const start = async () => {
    if(!live.isReady() || saving)return
    setSaving(true)
    try {
      const response = await startMatch(matchId)
      if (!response.success) {
        toast.add({ title: "Match not started", description: response.error.message, type: "error" })
        return
      }
      toast.add({ title: "Match started", description: "Scoring controls are now active.", type: "success" })
      await refresh()
    } catch {
      live.disconnect();live.reconnect()
      toast.add({title:"Reconnecting...",description:"Reloading the saved match state before continuing.",type:"warning"})
    } finally {
      setSaving(false)
    }
  }

  const attemptPoint=React.useCallback(async(pending:{command:PointCommand;previousA:number;previousB:number})=>{
    if(pointExecuting.current || !isReady())return
    pointExecuting.current=true
    let settled=false
    try{
      const response=await withScoreTimeout(adjustMatchPoint(pending.command))
      if(!response.success){
        if(response.error.code==="DATABASE_ERROR")throw new Error("Point outcome is unverified")
        settled=true
        toast.add({title:"Point not recorded",description:response.error.message,type:"error"})
        await resync()
        return
      }
      accept([response.data]);settled=true;retryDelay.current=2000
      const number=pending.command.gameNumber
      const nextGames=response.data.games
      const next=nextGames.find((g)=>g.gameNumber===number)!
      const previousState=getGameState(format,pending.previousA,pending.previousB)
      const nextState=getGameState(format,next.playerAScore,next.playerBScore)
      if(pending.command.delta===-1){
        if(previousState==="COMPLETED" && nextState!=="COMPLETED"){
          betweenIntervalGamesRef.current.delete(number);setIntervalSeconds(0);setNextGameAfterInterval(null)
        }
        if(!hasReachedIntervalThreshold(format,next.playerAScore,next.playerBScore)){
          intervalGamesRef.current.delete(number);setIntervalSeconds(0)
        }
        return
      }
      const gameJustCompleted=previousState!=="COMPLETED" && nextState==="COMPLETED"
      const nextNumber=gameJustCompleted ? getNextIncompleteGameNumber(format,nextGames,number):null
      const between=gameJustCompleted && nextNumber!==null && !isMatchComplete(format,nextGames) ? getBetweenGameIntervalSeconds(format):null
      if(between!==null && !betweenIntervalGamesRef.current.has(number)){
        betweenIntervalGamesRef.current.add(number);setIntervalSeconds(between);setNextGameAfterInterval(nextNumber)
        toast.add({title:"Game "+number+" complete",description:"Rest for "+between+" seconds before Game "+nextNumber+".",type:"warning"})
      }else{
        const interval=getCrossingIntervalSeconds(format,{playerAScore:pending.previousA,playerBScore:pending.previousB},next)
        if(interval!==null && !intervalGamesRef.current.has(number)){
          intervalGamesRef.current.add(number);setIntervalSeconds(interval)
          toast.add({title:"Interval called",description:"Scoring pauses for "+interval+" seconds.",type:"warning"})
        }
      }
    }catch{
      disconnect()
      if(retryTimer.current)clearTimeout(retryTimer.current)
      retryTimer.current=setTimeout(()=>{retryTimer.current=null;reconnect()},retryDelay.current)
      retryDelay.current=Math.min(retryDelay.current*2,15000)
    }finally{
      pointExecuting.current=false
      if(settled){pendingPoint.current=null;pointLocked.current=false;setSaving(false)}
    }
  },[format,isReady,resync,accept,disconnect,reconnect])

  React.useEffect(()=>{
    if(connected && pendingPoint.current && !pointExecuting.current)void attemptPoint(pendingPoint.current)
  },[connected,attemptPoint])

  const changePoint=(side:"a"|"b",delta:1|-1)=>{
    if(pointLocked.current || saving || !live.isReady() || !snapshot || (delta===1 ? !canScore:!canUndo))return
    if(delta===-1 && (side==="a" ? currentGame.playerAScore:currentGame.playerBScore)<=0)return
    pointLocked.current=true;setSaving(true)
    const pending={command:{matchId,gameNumber:selectedGame,side,delta,expectedVersion:snapshot.version,operationId:crypto.randomUUID()},previousA:currentGame.playerAScore,previousB:currentGame.playerBScore}
    pendingPoint.current=pending
    void attemptPoint(pending)
  }

  const submit = async () => {
    if(!live.isReady() || saving)return
    setSaving(true)
    try {
      const response = await submitMatchResult(matchId)
      if (!response.success) {
        toast.add({ title: "Result not submitted", description: response.error.message, type: "error" })
        return
      }
      toast.add({ title: "Result locked", description: "The result is now read-only for the umpire.", type: "success" })
      await refresh()
    } catch {
      live.disconnect();live.reconnect()
      toast.add({title:"Reconnecting...",description:"Reloading the saved match state before continuing.",type:"warning"})
    } finally {
      setSaving(false)
    }
  }

  const logCard = async (card: "YELLOW" | "RED" | "BLACK", playerId: string) => {
    if(!live.isReady() || saving)return
    setSaving(true)
    try {
      const response = await logDisciplinaryCard({ matchId, card, playerId })
      if (!response.success) {
        toast.add({ title: "Card not logged", description: response.error.message, type: "error" })
        return
      }
      toast.add({ title: `${card[0]}${card.slice(1).toLowerCase()} Card logged`, type: "success" })
      await refresh()
    } catch {
      live.disconnect();live.reconnect()
      toast.add({title:"Reconnecting...",description:"Reloading the saved match state before continuing.",type:"warning"})
    } finally {
      setSaving(false)
    }
  }

  const submitOverride = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if(!live.isReady() || saving)return
    if (["COMPLETED", "WALKOVER", "RETIRED"].includes(overrideStatus) && games.length === 0) {
      toast.add({ title: "Scores required", description: "Add or preserve at least one game score before finalizing.", type: "warning" })
      return
    }
    if (overrideReason.trim().length < 10) {
      toast.add({ title: "Reason required", description: "Enter at least 10 characters for the audit trail.", type: "warning" })
      return
    }
    setSaving(true)
    try {
      const response = await overrideMatchResult({
        matchId,
        status: overrideStatus,
        winnerId: ["COMPLETED", "WALKOVER", "RETIRED"].includes(overrideStatus) ? overrideWinner : null,
        scores: games,
        reason: overrideReason,
      })
      if (!response.success) {
        toast.add({ title: "Override not saved", description: response.error.message, type: "error" })
        return
      }
      setOverrideOpen(false)
      setOverrideReason("")
      toast.add({ title: "Override recorded", description: "The result and audit trail were updated together.", type: "success" })
      await refresh()
    } catch {
      live.disconnect();live.reconnect()
      toast.add({title:"Reconnecting...",description:"Reloading the saved match state before continuing.",type:"warning"})
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      {!connected && <p role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">{live.connection==="setup_required" ? "Live scoring is unavailable. An administrator must finish the database setup." : "Reconnecting… Point controls are paused until the saved score is synchronized."}</p>}
      {connected && saving && <p role="status" className="text-sm text-muted-foreground">Saving and confirming the match update…</p>}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Link href="/umpire" className="inline-flex min-h-11 w-fit items-center gap-2 rounded-lg px-2 text-sm font-semibold text-primary hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <ArrowLeft className="size-4" aria-hidden="true" /> Assigned matches
        </Link>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <Button variant="outline" className="min-h-11 gap-2" onClick={() => setOverrideOpen(true)}>
              <ShieldAlert className="size-4" aria-hidden="true" /> Referee override
            </Button>
          )}
          <Button variant="outline" className="min-h-11 gap-2" onClick={() => void refresh()}>
            <RotateCcw className="size-4" aria-hidden="true" /> Refresh
          </Button>
        </div>
      </div>

      <section className="overflow-hidden rounded-2xl bg-primary text-primary-foreground shadow-sm">
        <div className="grid gap-6 p-6 sm:p-8 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-blue-200">Live scoring console</p>
            <h1 className="mt-2 text-2xl font-bold sm:text-3xl">{data.match.player_a_name ?? "Player A"} <span className="font-normal text-blue-200">vs</span> {data.match.player_b_name ?? "Player B"}</h1>
            <div className="mt-4 flex flex-wrap gap-4 text-sm text-blue-100">
              <span>{data.match.court_number ? `Court ${data.match.court_number}` : "Court pending"}</span>
              <span>{format === "STANDARD_3X21" ? "Best of 3 × 21" : "Single game × 30"}</span>
              <span className="inline-flex items-center gap-1.5"><span className={`size-2 rounded-full ${matchStatus === "IN_PROGRESS" ? "bg-emerald-400" : "bg-blue-300"}`} />{matchStatus.replaceAll("_", " ")}</span>
              <span className="rounded-full bg-white/10 px-2 py-1 text-xs font-semibold">{getMatchStageLabel(data.match)}</span>
            </div>
          </div>
          <div className="rounded-xl bg-white/10 p-4 text-sm">
            <p className="font-semibold">Operator rule</p>
            <p className="mt-1 max-w-xs text-xs leading-5 text-blue-100">Point controls stay disabled during intervals and after result sign-off.</p>
          </div>
        </div>
      </section>

      {completedGames.length > 0 && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="score-summary-heading">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 id="score-summary-heading" className="text-lg font-bold">Score summary</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {winnerName
                  ? `${winnerName} wins ${playerAGameWins}–${playerBGameWins} in games.`
                  : `Current game score: ${playerAGameWins}–${playerBGameWins}.`}
              </p>
            </div>
            <span className="w-fit rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800">
              {matchComplete ? "Match complete" : "Score so far"}
            </span>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[620px] text-left text-sm">
              <thead className="border-b text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-3 py-3">Game</th>
                  <th className="px-3 py-3">{data.match.player_a_name ?? "Player A"}</th>
                  <th className="px-3 py-3">{data.match.player_b_name ?? "Player B"}</th>
                  <th className="px-3 py-3">Winner</th>
                  <th className="px-3 py-3">Margin</th>
                </tr>
              </thead>
              <tbody>
                {completedGames.map((game) => {
                  const playerAWon = game.playerAScore > game.playerBScore
                  const margin = Math.abs(game.playerAScore - game.playerBScore)
                  const gameWinner = playerAWon
                    ? data.match.player_a_name ?? "Player A"
                    : data.match.player_b_name ?? "Player B"
                  return (
                    <tr key={game.gameNumber} className="border-b last:border-0">
                      <td className="px-3 py-3 font-semibold">Game {game.gameNumber}</td>
                      <td className="px-3 py-3 text-lg font-bold tabular-nums">{game.playerAScore}</td>
                      <td className="px-3 py-3 text-lg font-bold tabular-nums">{game.playerBScore}</td>
                      <td className="px-3 py-3 font-semibold text-emerald-800">{gameWinner}</td>
                      <td className="px-3 py-3 text-muted-foreground">By {margin} point{margin === 1 ? "" : "s"}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {completedGames.map((game) => {
              const total = Math.max(game.playerAScore, game.playerBScore, 1)
              return (
                <div key={`chart-${game.gameNumber}`} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-sm font-semibold">Game {game.gameNumber} score distribution</p>
                  <div className="mt-3 space-y-2">
                    <div className="flex items-center gap-3 text-xs"><span className="w-24 truncate">{data.match.player_a_name ?? "Player A"}</span><div className="h-3 flex-1 overflow-hidden rounded-full bg-blue-100"><div className="h-full rounded-full bg-blue-600" style={{ width: `${(game.playerAScore / total) * 100}%` }} /></div><span className="w-6 text-right font-bold tabular-nums">{game.playerAScore}</span></div>
                    <div className="flex items-center gap-3 text-xs"><span className="w-24 truncate">{data.match.player_b_name ?? "Player B"}</span><div className="h-3 flex-1 overflow-hidden rounded-full bg-violet-100"><div className="h-full rounded-full bg-violet-600" style={{ width: `${(game.playerBScore / total) * 100}%` }} /></div><span className="w-6 text-right font-bold tabular-nums">{game.playerBScore}</span></div>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {matchStatus === "SCHEDULED" || matchStatus === "READY" ? (
        <section className="rounded-2xl border border-blue-200 bg-blue-50 p-6 text-center">
          <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-blue-600 text-white"><Play className="size-7" aria-hidden="true" /></div>
          <h2 className="mt-4 text-lg font-bold text-blue-950">Ready to start?</h2>
          <p className="mx-auto mt-1 max-w-lg text-sm leading-6 text-blue-900">Starting locks the match into live scoring and begins the audit trail.</p>
          <Button className="mt-5 min-h-12" onClick={() => void start()} disabled={saving || !connected}><Play className="size-4" aria-hidden="true" />{saving ? "Starting…" : "Start match"}</Button>
        </section>
      ) : null}

      {matchStatus === "IN_PROGRESS" && (
        <section className="space-y-4" aria-labelledby="scoreboard-heading">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 id="scoreboard-heading" className="text-xl font-bold">Scoreboard</h2>
              <p className="text-sm text-muted-foreground">Use the large controls. Each point is validated against the configured format.</p>
            </div>
            {matchComplete && <span className="inline-flex items-center gap-2 text-sm font-semibold text-emerald-700"><CheckCircle2 className="size-5" aria-hidden="true" />Ready for sign-off</span>}
          </div>

          <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Games">
            {(format === "STANDARD_3X21" ? [1, 2, 3] : [1]).map((gameNumber) => {
              const game = games.find((item) => item.gameNumber === gameNumber)
              const complete = game ? getGameState(format, game.playerAScore, game.playerBScore) === "COMPLETED" : false
              return (
                <button
                  key={gameNumber}
                  type="button"
                  role="tab"
                  aria-selected={selectedGame === gameNumber}
                  disabled={saving || intervalSeconds > 0 || nextGameAfterInterval !== null}
                  onClick={() => setSelectedGame(gameNumber)}
                  className={`min-h-12 shrink-0 rounded-xl border px-4 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60 ${selectedGame === gameNumber ? "border-blue-500 bg-blue-50 text-blue-900" : "border-slate-200 bg-white text-slate-700"}`}
                >
                  {gameLabel(gameNumber)} {complete ? "· Final" : game ? "· Live" : ""}
                </button>
              )
            })}
          </div>

          {intervalSeconds > 0 && (
            <div className="flex items-center justify-between gap-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950" role="status" aria-live="assertive">
              <div className="flex items-center gap-3"><Clock3 className="size-6 text-amber-700" aria-hidden="true" /><div><p className="font-bold">{nextGameAfterInterval ? "Between-games rest" : "Interval in progress"}</p><p className="text-sm">{nextGameAfterInterval ? `Game ${nextGameAfterInterval} will start automatically when the timer ends.` : "Scoring resumes automatically when the timer ends."}</p></div></div>
              <p className="text-3xl font-bold tabular-nums">{intervalSeconds}s</p>
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            {(["a", "b"] as const).map((side) => {
              const playerName = side === "a" ? data.match.player_a_name ?? "Player A" : data.match.player_b_name ?? "Player B"
              const score = side === "a" ? currentGame.playerAScore : currentGame.playerBScore
              return (
                <div key={side} className={`rounded-2xl border p-5 ${side === "a" ? "border-blue-200 bg-blue-50/60" : "border-violet-200 bg-violet-50/60"}`}>
                  <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-3"><div className="flex size-11 items-center justify-center rounded-full bg-white text-primary shadow-sm"><UserRound className="size-5" aria-hidden="true" /></div><div><p className="text-sm font-semibold text-slate-900">{playerName}</p><p className="text-xs text-slate-500">{side === "a" ? "Home side" : "Away side"}</p></div></div><span className="text-xs font-semibold text-slate-500">{side === "a" ? "Player A" : "Player B"}</span></div>
                  <p className="mt-8 text-center text-7xl font-black tabular-nums tracking-tight text-slate-950">{score}</p>
                  <Button className="mt-6 min-h-20 w-full text-lg font-bold" variant={side === "a" ? "default" : "secondary"} onClick={() => changePoint(side,1)} disabled={!canScore || saving} aria-label={`Add one point for ${playerName}`}>
                    <ChevronRight className="size-6" aria-hidden="true" /> Point for {side === "a" ? "A" : "B"}
                  </Button>
                  <Button className="mt-3 min-h-12 w-full" variant="outline" onClick={()=>changePoint(side,-1)} disabled={!canUndo || saving || score<=0} aria-label={`Remove one point from ${playerName}`}>− Remove point</Button>
                </div>
              )
            })}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div><h3 className="font-bold">Disciplinary actions</h3><p className="mt-1 text-sm text-muted-foreground">Yellow is a warning, Red adds one opponent point, and Black requires committee confirmation.</p></div>
              <div className="flex flex-wrap gap-2">
                {(["YELLOW", "RED", "BLACK"] as const).map((card) => (
                  <div key={card} className="flex items-center gap-1.5 rounded-lg border border-slate-200 p-1.5">
                    <select className="min-h-10 rounded-md border border-slate-200 bg-white px-2 text-xs" defaultValue={data.match.player_a_id} aria-label={`Player for ${card.toLowerCase()} card`} id={`${card}-player`}>
                      <option value={data.match.player_a_id}>{data.match.player_a_name ?? "Player A"}</option>
                      <option value={data.match.player_b_id}>{data.match.player_b_name ?? "Player B"}</option>
                    </select>
                    <Button size="sm" className="min-h-10" onClick={() => {
                      const playerId = (document.getElementById(`${card}-player`) as HTMLSelectElement | null)?.value
                      if (playerId) void logCard(card, playerId)
                    }} disabled={saving || !canLogCard || (card === "BLACK" && !isAdmin)}>{card[0] + card.slice(1).toLowerCase()}</Button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div><h3 className="flex items-center gap-2 font-bold text-emerald-950"><Trophy className="size-5" aria-hidden="true" />Final sign-off</h3><p className="mt-1 text-sm text-emerald-900">Review the score summary before locking the result. A short reason cannot be bypassed.</p></div>
            <Button className="min-h-12 shrink-0 gap-2" onClick={() => void submit()} disabled={!connected || !matchComplete || saving}><LockKeyhole className="size-4" aria-hidden="true" />{saving ? "Submitting…" : "Submit and lock result"}</Button>
          </div>
        </section>
      )}

      {locked && (
        <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-center">
          <LockKeyhole className="mx-auto size-8 text-emerald-700" aria-hidden="true" />
          <h2 className="mt-3 text-lg font-bold text-emerald-950">Result locked</h2>
          <p className="mt-1 text-sm text-emerald-900">This result is read-only for the umpire. A committee administrator must use Referee override for any correction.</p>
        </section>
      )}

      {data.events.length > 0 && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="font-bold">Match event log</h2>
          <ul className="mt-3 space-y-2 text-sm text-slate-700">
            {data.events.map((event) => <li key={event.id} className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2"><span>{event.event_type.replaceAll("_", " ")}{event.card ? ` · ${event.card}` : ""}</span><time className="text-xs text-slate-500">{new Date(event.event_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></li>)}
          </ul>
        </section>
      )}

      <Dialog open={overrideOpen} onOpenChange={setOverrideOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Referee override</DialogTitle><DialogDescription>Administrative correction with a mandatory audit reason.</DialogDescription></DialogHeader>
          <form onSubmit={submitOverride} className="space-y-5 pt-2">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2"><Label htmlFor="override-status">New status</Label><select id="override-status" className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm" value={overrideStatus} onChange={(event) => setOverrideStatus(event.target.value as typeof overrideStatus)}><option value="COMPLETED">Completed</option><option value="WALKOVER">Walkover</option><option value="RETIRED">Retired</option><option value="CANCELLED">Cancelled</option><option value="POSTPONED">Postponed</option></select></div>
              <div className="space-y-2"><Label htmlFor="override-winner">Winner (when required)</Label><select id="override-winner" className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm" value={overrideWinner} onChange={(event) => setOverrideWinner(event.target.value)}><option value={data.match.player_a_id}>{data.match.player_a_name ?? "Player A"}</option><option value={data.match.player_b_id}>{data.match.player_b_name ?? "Player B"}</option></select></div>
            </div>
            <div className="space-y-2"><Label htmlFor="override-reason">Reason for audit</Label><textarea id="override-reason" className="min-h-28 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-600 focus:ring-3 focus:ring-blue-100" value={overrideReason} onChange={(event) => setOverrideReason(event.target.value)} placeholder="Describe the verified correction and source of truth" /></div>
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-950"><AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />The current score ({games.length ? games.map((game) => `${game.playerAScore}–${game.playerBScore}`).join(", ") : "0–0"}) will be stored with the new status and reason in one protected operation.</div>
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end"><Button type="button" variant="outline" className="min-h-11" onClick={() => setOverrideOpen(false)} disabled={saving}>Cancel</Button><Button type="submit" className="min-h-11" disabled={saving || !connected}>{saving ? "Recording…" : "Record override"}</Button></div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
