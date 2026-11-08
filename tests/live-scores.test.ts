import { afterEach,describe,expect,it,vi } from "vitest"
import { LiveScoreSession,mergeLiveScores,withScoreTimeout,type LiveScore,type ScoreConnection } from "../lib/realtime/live-scores"

const score=(version:number):LiveScore=>({match_id:"40000000-0000-4000-8000-000000000001",category_id:"40000000-0000-4000-8000-000000000002",group_id:null,status:"IN_PROGRESS",winner_id:null,games:[{gameNumber:1,playerAScore:version,playerBScore:0}],version,updated_at:"2026-11-09T00:00:00Z"})
function deferred<T>(){let resolve!:(v:T)=>void;const promise=new Promise<T>((r)=>{resolve=r});return{promise,resolve}}
afterEach(()=>vi.useRealTimers())
describe("live score reconnect and ordering",()=>{
  it("only updates the affected match and ignores old or duplicate event versions",()=>{
    const current={[score(4).match_id]:score(4),other:{...score(1),match_id:"other"}}
    expect(mergeLiveScores(current,[score(3),score(4)])).toBe(current)
    const next=mergeLiveScores(current,[score(6),score(5)])
    expect(next[score(1).match_id].version).toBe(6);expect(next.other).toBe(current.other)
  })
  it("keeps controls locked until the subscribed channel has loaded its database snapshot",async()=>{
    const read=deferred<LiveScore[]>(),states:ScoreConnection[]=[]
    const session=new LiveScoreSession({fetch:()=>read.promise,onScores:vi.fn(),onState:(s)=>states.push(s)})
    const joining=session.joined()
    expect(session.isReady()).toBe(false);expect(states.at(-1)).toBe("syncing")
    read.resolve([score(1)]);await joining
    expect(session.isReady()).toBe(true);expect(states.at(-1)).toBe("connected")
  })
  it("cannot reenable scoring when an old read finishes after a disconnect",async()=>{
    const read=deferred<LiveScore[]>(),receive=vi.fn(),states:ScoreConnection[]=[]
    const session=new LiveScoreSession({fetch:()=>read.promise,onScores:receive,onState:(s)=>states.push(s)})
    const pending=session.joined();session.setOnline(false);read.resolve([score(1)]);await pending
    expect(session.isReady()).toBe(false);expect(receive).not.toHaveBeenCalled();expect(states.at(-1)).toBe("offline")
  })
  it("resynchronizes after reconnect and never lets an older snapshot overwrite a newer broadcast",async()=>{
    const read=deferred<LiveScore[]>();let scores={}
    const session=new LiveScoreSession({fetch:()=>read.promise,onScores:(rows)=>{scores=mergeLiveScores(scores,rows)},onState:vi.fn()})
    const joining=session.joined();session.receive([score(5)]);read.resolve([score(2)]);await joining
    expect(scores).toEqual({[score(5).match_id]:score(5)})
    session.disconnected();expect(session.isReady()).toBe(false)
    await session.joined();expect(session.isReady()).toBe(true)
  })
  it("coalesces concurrent catch-up reads and ignores completions after unmount",async()=>{
    const read=deferred<LiveScore[]>(),fetch=vi.fn(()=>read.promise),receive=vi.fn()
    const session=new LiveScoreSession({fetch,onScores:receive,onState:vi.fn()})
    const first=session.joined(),second=session.refresh()
    expect(fetch).toHaveBeenCalledTimes(1);session.stop();read.resolve([score(1)]);await Promise.all([first,second])
    expect(receive).not.toHaveBeenCalled();expect(session.isReady()).toBe(false)
  })
  it("shows setup required rather than enabling buttons if the snapshot table is missing",async()=>{
    const states:ScoreConnection[]=[]
    const session=new LiveScoreSession({fetch:()=>Promise.reject({code:"PGRST205"}),onScores:vi.fn(),onState:(s)=>states.push(s)})
    await session.joined();expect(session.isReady()).toBe(false);expect(states.at(-1)).toBe("setup_required")
  })
  it("bounds network request duration and clears timers after a normal response",async()=>{
    vi.useFakeTimers()
    expect(await withScoreTimeout(Promise.resolve("saved"),500)).toBe("saved")
    expect(vi.getTimerCount()).toBe(0)
    const pending=withScoreTimeout(new Promise(()=>{}),500)
    const rejection=expect(pending).rejects.toThrow("timed out")
    await vi.advanceTimersByTimeAsync(500);await rejection;expect(vi.getTimerCount()).toBe(0)
  })
})
