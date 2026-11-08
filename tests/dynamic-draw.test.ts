import { describe,expect,it } from "vitest"
import { buildSeededBracket,nextBracketSize,type BracketSeed } from "../lib/tournament/bracket"
import { dynamicGroupCount,distributePlayers,generateRoundRobinRounds,generateRoundRobinMatches,type Player } from "../lib/tournament/draw-engine"

const players = (n:number):Player[] => Array.from({ length:n },(_,i) => ({ id:`entry-${i+1}`,full_name:`Entry ${i+1}` }))
const seeds = (n:number):BracketSeed[] => players(n).map((p,i) => ({ seed:i+1,groupName:"Entries",place:i+1,playerId:p.id,playerName:p.full_name }))

describe("draws from actual entries",() => {
  it.each([2,3,5,6,7,9,17,31,32,33,64,65,1000])("covers all %i entries exactly once and has only paired matches or explicit byes",(count) => {
    const rounds=buildSeededBracket(seeds(count),count,()=>0.42)
    const first=rounds[0].pairings
    expect(first).toHaveLength(nextBracketSize(count)/2)
    expect(first.filter((p) => p.byePlayerId)).toHaveLength(nextBracketSize(count)-count)
    const ids=first.flatMap((p) => [p.playerAId,p.playerBId].filter((id):id is string => !!id))
    expect(ids).toHaveLength(count); expect(new Set(ids).size).toBe(count)
    for(const pair of first) {
      expect(pair.playerAId).toBeTruthy()
      if(pair.byePlayerId) {expect(pair.playerBId).toBeNull();expect(pair.byePlayerId).toBe(pair.playerAId)}
      else {expect(pair.playerBId).toBeTruthy();expect(pair.playerBId).not.toBe(pair.playerAId)}
    }
    expect(rounds.at(-1)?.pairings).toHaveLength(1)
  })
  it("selects bye recipients randomly rather than always giving them to top seeds",() => {
    const recipients=(random:()=>number) => buildSeededBracket(seeds(5),5,random)[0].pairings.filter((p)=>p.byePlayerId).map((p)=>p.byePlayerId).sort()
    expect(recipients(()=>0)).not.toEqual(recipients(()=>0.999))
  })
  it.each([2,3,4,5,7,9,17,31,65,1000])("derives balanced playable groups for %i entries",(count) => {
    const groups=distributePlayers(players(count),dynamicGroupCount(count,4),()=>0.42)
    expect(groups.every((g)=>g.players.length>=2)).toBe(true)
    expect(groups.flatMap((g)=>g.players)).toHaveLength(count)
    expect(Math.max(...groups.map((g)=>g.players.length))-Math.min(...groups.map((g)=>g.players.length))).toBeLessThanOrEqual(1)
  })
  it.each([2,3,4,5,7,8,9])("creates every real round-robin pair once for an odd/even field of %i",(count) => {
    const group={ name:"Group A",players:players(count) }
    const rounds=generateRoundRobinRounds(group)
    const matches=generateRoundRobinMatches([group])
    expect(matches).toHaveLength(count*(count-1)/2)
    expect(new Set(matches.map((m)=>[m.player_a_id,m.player_b_id].sort().join(":"))).size).toBe(matches.length)
    for(const round of rounds) {
      const playing=round.matches.flatMap((m)=>[m.player_a_id,m.player_b_id])
      expect(new Set(playing).size).toBe(playing.length)
      expect(round.restingPlayerIds).toHaveLength(count%2)
      expect([...playing,...round.restingPlayerIds]).toHaveLength(count)
    }
    if(count%2) expect(new Set(rounds.flatMap((r)=>r.restingPlayerIds)).size).toBe(count)
  })
  it("rejects zero/one entry fields and duplicate competitors",() => {
    for(const n of [0,1]) {expect(()=>dynamicGroupCount(n)).toThrow();expect(()=>buildSeededBracket(seeds(n))).toThrow()}
    const repeated=seeds(3); repeated[1].playerId=repeated[0].playerId
    expect(()=>buildSeededBracket(repeated)).toThrow("unique")
  })
})
