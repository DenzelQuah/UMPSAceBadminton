import { describe,expect,it } from "vitest"
import type { Match } from "../app/(dashboard)/tournaments/types"
import { playerMatchTime,playerOpponent,playerWonMatch,scheduledPlayerMatches } from "../lib/tournament/player-schedule"

const match = (changes:Partial<Match> = {}):Match => ({
  id:"match",category_id:"category",group_id:null,knockout_round:1,knockout_stage:"Final",
  player_a_id:"alice",player_b_id:"bob",player_a_partner_id:"amy",player_b_partner_id:"ben",
  player_a_name:"Alice / Amy",player_b_name:"Bob / Ben",status:"SCHEDULED",court_number:2,
  scheduled_time:"2026-11-10T02:00:00Z",estimated_start_time:null,umpire_id:null,linesman_id:null,winner_id:null,created_at:"2026-11-09T00:00:00Z",...changes,
})

describe("personal player schedule",()=>{
  it("keeps only unfinished fixtures for the player, including both doubles partners",()=>{
    const other=match({id:"other",player_a_id:"carol",player_b_id:"dan",player_a_partner_id:null,player_b_partner_id:null})
    const rows=[match({id:"scheduled"}),match({id:"ready",status:"READY"}),match({id:"live",status:"IN_PROGRESS"}),match({id:"postponed",status:"POSTPONED"}),other,
      ...["COMPLETED","WALKOVER","RETIRED","CANCELLED"].map((status)=>match({id:status,status}))]
    for(const player of ["alice","amy","bob","ben"]) expect(scheduledPlayerMatches(rows,player).map((m)=>m.id)).toEqual(["live","ready","scheduled","postponed"])
  })
  it("puts live and timed fixtures first without hiding a delayed but unplayed fixture",()=>{
    const rows=[match({id:"unscheduled",scheduled_time:null}),match({id:"late",scheduled_time:"2026-11-11T00:00:00Z"}),match({id:"early",scheduled_time:"2026-11-08T00:00:00Z"}),match({id:"live",status:"IN_PROGRESS"})]
    expect(scheduledPlayerMatches(rows,"alice").map((m)=>m.id)).toEqual(["live","early","late","unscheduled"])
    expect(rows.map((m)=>m.id)).toEqual(["unscheduled","late","early","live"])
  })
  it("does not expose leftover fixtures from completed or archived events as upcoming",()=>{
    const rows=[match({id:"ended",tournament_status:"COMPLETED"}),match({id:"archive",category_status:"ARCHIVED"})]
    expect(scheduledPlayerMatches(rows,"amy")).toEqual([])
    expect(scheduledPlayerMatches([match({status:"COMPLETED",winner_id:"bob"})],"alice")).toEqual([])
  })
  it("finds the opposing side and result correctly for all four doubles athletes",()=>{
    const fixture=match({winner_id:"alice"})
    for(const player of ["alice","amy"]) {expect(playerOpponent(fixture,player)).toBe("Bob / Ben");expect(playerWonMatch(fixture,player)).toBe(true)}
    for(const player of ["bob","ben"]) {expect(playerOpponent(fixture,player)).toBe("Alice / Amy");expect(playerWonMatch(fixture,player)).toBe(false)}
    expect(playerWonMatch(fixture,"outsider")).toBe(false)
  })
  it("formats times in Malaysia and labels missing, estimated and postponed times honestly",()=>{
    const time=playerMatchTime(match())
    expect(time).toContain("10 Nov 2026");expect(time).toMatch(/10:00/)
    expect(playerMatchTime(match({scheduled_time:null}))).toBe("TBA — to be announced")
    expect(playerMatchTime(match({scheduled_time:null,estimated_start_time:"2026-11-10T02:00:00Z"}))).toMatch(/^Estimated:/)
    expect(playerMatchTime(match({estimated_start_time:"2026-11-10T03:00:00Z"}))).toMatch(/^Estimated:.*11:00/)
    expect(playerMatchTime(match({status:"POSTPONED"}))).toBe("Awaiting a new schedule")
  })
})
