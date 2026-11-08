import { PGlite } from "@electric-sql/pglite"
import { readFileSync,readdirSync } from "node:fs"
import { afterAll,afterEach,beforeAll,beforeEach,describe,expect,it } from "vitest"
import { buildSeededBracket,nextBracketSize,type BracketPayload,type BracketSeed } from "../lib/tournament/bracket"
import { dynamicGroupCount,distributePlayers,generateRoundRobinRounds } from "../lib/tournament/draw-engine"

let db:PGlite
const id=(n:number)=>`40000000-0000-4000-8000-${String(n).padStart(12,"0")}`
const admin=id(1)
async function actor(user=admin) {await db.exec("RESET ROLE");await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[user]);await db.exec("SET ROLE authenticated")}
async function denied(operation:()=>Promise<unknown>,code="22023") {
  await db.exec("SAVEPOINT denied");try{await expect(operation()).rejects.toMatchObject({ code })}finally{await db.exec("ROLLBACK TO SAVEPOINT denied; RELEASE SAVEPOINT denied")}
}
async function fixture(count:number,drawFormat="SINGLE_ELIMINATION",target=4,qualifiers=1,doubles=false) {
  await db.exec("RESET ROLE")
  const t=(await db.query<{id:string}>("INSERT INTO public.tournaments(title,location,court_count,start_date,end_date) VALUES('Dynamic test','UMPSA',4,'2026-11-10','2026-11-11') RETURNING id")).rows[0].id
  await actor()
  const c=(await db.query<{id:string}>("SELECT id FROM public.create_dynamic_category($1,'Dynamic category',64,$2,'SINGLE_SET_1X30',$3,$4,$5)",[t,qualifiers,doubles ? "DOUBLES":"SINGLES",drawFormat,target])).rows[0].id
  await db.query("SELECT public.set_category_registration_status($1,'REGISTRATION_OPEN')",[c])
  for(let i=0;i<count;i++) {
    const user=id(10+i*(doubles ? 2:1))
    await actor(user)
    if(doubles) {
      const invitation=(await db.query<{id:string}>("SELECT public.invite_doubles_partner($1,$2) AS id",[c,`${id(11+i*2)}@adab.umpsa.edu.my`])).rows[0].id
      await actor(id(11+i*2));await db.query("SELECT public.respond_doubles_invitation($1,'ACCEPT')",[invitation])
    } else await db.query("SELECT public.register_for_category($1)",[c])
  }
  await actor()
  return { t,c }
}
async function payload(c:string):Promise<BracketPayload> {
  const entries=(await db.query<{player_id:string}>("SELECT player_id FROM public.registrations WHERE category_id=$1 AND status='CONFIRMED' ORDER BY player_id",[c])).rows
  const seeds:BracketSeed[]=entries.map((e,i)=>({ seed:i+1,groupName:"Entries",place:i+1,playerId:e.player_id,playerName:e.player_id }))
  const rounds=buildSeededBracket(seeds,seeds.length,()=>0.42)
  return {qualifier_count:seeds.length,bracket_size:nextBracketSize(seeds.length),bye_count:nextBracketSize(seeds.length)-seeds.length,
    seeds:seeds.map((s)=>({seed:s.seed,group_name:s.groupName,place:s.place,player_id:s.playerId,player_name:s.playerName})),
    rounds:rounds.map((r)=>({round:r.round,label:r.label,pairings:r.pairings.map((p)=>({index:p.index,player_a_id:p.playerAId,player_b_id:p.playerBId,bye_player_id:p.byePlayerId ?? null,source_pairing_indexes:p.sourcePairingIndexes,match_id:null}))}))}
}
async function save(c:string,bracket:BracketPayload) {return db.query("SELECT public.save_category_knockout_preview($1,$2,$3::jsonb)",[c,bracket.qualifier_count,JSON.stringify(bracket)])}
async function finish(match:string) {
  await db.query("SELECT public.start_match($1)",[match]);await db.query("SELECT public.record_game_score($1,1,30,10)",[match]);await db.query("SELECT public.submit_match_result($1)",[match])
}
beforeAll(async()=>{
  db=new PGlite()
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth;GRANT USAGE ON SCHEMA auth TO authenticated,anon;
    CREATE TABLE auth.users(id UUID PRIMARY KEY,email TEXT,raw_user_meta_data JSONB DEFAULT '{}');
    CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE SQL STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::UUID $$;`)
  for(const file of readdirSync("supabase/migrations").filter((f)=>f.endsWith(".sql")).sort()) {
    if(file === "20261108164632_dynamic_draws_and_byes.sql") {
      await db.query("INSERT INTO public.tournaments(id,title,location,court_count,start_date,end_date) VALUES($1,'Historic event','UMPSA',2,'2026-10-01','2026-10-02')",[id(100)])
      await db.query("INSERT INTO public.categories(id,tournament_id,name,max_capacity,group_count,status) VALUES($1,$2,'Historic singles',16,3,'COMPLETED')",[id(101),id(100)])
      await db.query("UPDATE public.tournaments SET status='COMPLETED' WHERE id=$1",[id(100)])
    }
    try{await db.exec(readFileSync(`supabase/migrations/${file}`,"utf8"))}catch(error){throw new Error(`Migration failed: ${file}`,{cause:error})}
  }
  for(const n of [1,...Array.from({length:40},(_,i)=>i+10)]) await db.query("INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES($1,$2,$3)",[id(n),`${id(n)}@adab.umpsa.edu.my`,JSON.stringify({full_name:`Entry ${n}`})])
  await db.query("UPDATE public.profiles SET is_admin=true WHERE id=$1",[admin])
},30000)
beforeEach(async()=>{await db.exec("RESET ROLE; BEGIN")})
afterEach(async()=>{await db.exec("ROLLBACK; RESET ROLE")})
afterAll(async()=>{await db?.close()})

describe("dynamic draw publication and advancement",()=>{
  it("keeps later rounds TBA and lets MT schedule a ready semifinal while other quarterfinals are unfinished",async()=>{
    const {c}=await fixture(8)
    await db.query("SELECT public.set_category_registration_status($1,'REGISTRATION_CLOSED')",[c])
    await save(c,await payload(c));await db.query("SELECT public.publish_category_knockout_bracket($1)",[c])
    const published=(await db.query<{bracket_payload:BracketPayload}>("SELECT bracket_payload FROM public.category_knockout_previews WHERE category_id=$1",[c])).rows[0].bracket_payload
    const quarters=published.rounds[0].pairings
    expect(published.rounds[1].pairings.every((pairing)=>pairing.match_id===null)).toBe(true)
    await finish(quarters[0].match_id!)
    expect((await db.query("SELECT id FROM public.matches WHERE category_id=$1 AND knockout_round=2",[c])).rows).toHaveLength(0)
    await finish(quarters[1].match_id!)
    const semi=(await db.query<{id:string;scheduled_time:string | null;estimated_start_time:string | null;court_number:number | null}>("SELECT id,scheduled_time,estimated_start_time,court_number FROM public.matches WHERE category_id=$1 AND knockout_round=2",[c])).rows
    expect(semi).toHaveLength(1)
    expect(semi[0]).toMatchObject({scheduled_time:null,estimated_start_time:null,court_number:null})
    expect((await db.query("SELECT id FROM public.matches WHERE category_id=$1 AND knockout_round=1 AND status='SCHEDULED'",[c])).rows).toHaveLength(2)
    await db.exec("RESET ROLE");await db.query("UPDATE public.profiles SET organizational_role='MT' WHERE id=$1",[id(45)])
    await actor(id(45))
    await db.query("SELECT public.schedule_match($1,2,'2026-11-10T02:00:00Z',null,null)",[semi[0].id])
    const saved=(await db.query<{scheduled_time:Date;estimated_start_time:Date;court_number:number}>("SELECT scheduled_time,estimated_start_time,court_number FROM public.matches WHERE id=$1",[semi[0].id])).rows[0]
    expect(new Date(saved.scheduled_time).toISOString()).toBe("2026-11-10T02:00:00.000Z")
    expect(new Date(saved.estimated_start_time).toISOString()).toBe("2026-11-10T02:00:00.000Z")
    expect(saved.court_number).toBe(2)
  })
  it("upgrades a database containing completed tournament history without rewriting its draw",async()=>{
    expect((await db.query<{group_count:number;status:string}>("SELECT group_count,status FROM public.categories WHERE id=$1",[id(101)])).rows[0]).toEqual({group_count:3,status:"COMPLETED"})
  })
  it.each([2,3,5,6,7,9,17])("runs a %i-entry elimination to a final with exactly N-1 real matches",async(count)=>{
    const {t,c}=await fixture(count)
    await db.query("SELECT public.set_category_registration_status($1,'REGISTRATION_CLOSED')",[c])
    const bracket=await payload(c)
    await save(c,bracket)
    await db.query("SELECT public.publish_category_knockout_bracket($1)",[c])
    let completed=0
    while(true) {
      const pending=(await db.query<{id:string}>("SELECT id FROM public.matches WHERE category_id=$1 AND status='SCHEDULED' ORDER BY knockout_round DESC,id DESC",[c])).rows
      if(!pending.length)break
      for(const match of pending){await finish(match.id);completed++}
      if(completed>count)throw Error("Bracket generated extra matches")
    }
    expect(completed).toBe(count-1)
    expect((await db.query("SELECT id FROM public.audit_logs WHERE action IN ('KNOCKOUT_MATCH_CREATED','KNOCKOUT_MATCH_ADVANCED') AND new_data->>'category_id'=$1",[c])).rows).toHaveLength(count-1)
    expect((await db.query("SELECT id FROM public.matches WHERE category_id=$1 AND knockout_round=$2 AND winner_id IS NOT NULL",[c,Math.log2(nextBracketSize(count))])).rows).toHaveLength(1)
    expect((await db.query("SELECT id FROM public.matches WHERE category_id=$1 AND (player_a_id IS NULL OR player_b_id IS NULL OR player_a_id=player_b_id)",[c])).rows).toHaveLength(0)
    await db.query("SELECT public.complete_tournament($1)",[t])
    // Byes produce neither match records nor phantom ranking wins.
    const wins=(await db.query<{wins:number}>("SELECT coalesce(sum(matches_won),0)::INTEGER AS wins FROM public.global_rankings")).rows[0].wins
    expect(wins).toBe(count-1)
  })
  it("uses confirmed entries only, regardless of capacity, waitlist or withdrawn registrations",async()=>{
    const {c}=await fixture(5)
    await db.exec("RESET ROLE")
    await db.query("INSERT INTO public.registrations(category_id,player_id,status) VALUES($1,$2,'WAITLISTED'),($1,$3,'WITHDRAWN')",[c,id(20),id(21)])
    await actor();await db.query("SELECT public.set_category_registration_status($1,'REGISTRATION_CLOSED')",[c])
    const bracket=await payload(c);expect(bracket.qualifier_count).toBe(5);expect(bracket.bracket_size).toBe(8)
    await save(c,bracket)
    expect((await db.query<{qualifier_count:number}>("SELECT qualifier_count FROM public.category_knockout_previews WHERE category_id=$1",[c])).rows[0].qualifier_count).toBe(5)
  })
  it.each([3,5,7,9])("publishes paired round-robin rounds and balanced groups for %i confirmed entries",async(count)=>{
    const {c}=await fixture(count,"ROUND_ROBIN",4)
    await db.query("SELECT public.set_category_registration_status($1,'REGISTRATION_CLOSED')",[c])
    const groupCount=(await db.query<{group_count:number}>("SELECT group_count FROM public.categories WHERE id=$1",[c])).rows[0].group_count
    expect(groupCount).toBe(dynamicGroupCount(count,4))
    const entries=(await db.query<{player_id:string;full_name:string}>("SELECT r.player_id,p.full_name FROM public.registrations r JOIN public.profiles p ON p.id=r.player_id WHERE r.category_id=$1 AND r.status='CONFIRMED'",[c])).rows.map((r)=>({id:r.player_id,full_name:r.full_name}))
    const groups=distributePlayers(entries,groupCount,()=>0.42)
    await db.query("SELECT public.save_category_draw_preview($1,$2::jsonb)",[c,JSON.stringify(groups)])
    await db.query("SELECT public.publish_category_draw($1)",[c])
    const matches=(await db.query<{group_id:string;group_round:number;player_a_id:string;player_b_id:string}>("SELECT * FROM public.matches WHERE category_id=$1",[c])).rows
    expect(matches).toHaveLength(groups.reduce((sum,g)=>sum+g.players.length*(g.players.length-1)/2,0))
    for(const g of groups) {
      const rounds=generateRoundRobinRounds(g)
      const groupId=(await db.query<{id:string}>("SELECT id FROM public.groups WHERE category_id=$1 AND name=$2",[c,g.name])).rows[0].id
      for(const r of rounds) {
        const actual=matches.filter((m)=>m.group_id===groupId && m.group_round===r.round)
        expect(actual.map((m)=>[m.player_a_id,m.player_b_id].sort().join(":"))).toEqual(r.matches.map((m)=>[m.player_a_id,m.player_b_id].sort().join(":")))
      }
    }
  })
  it("treats five doubles pairs as five bracket entries and preserves partners during advancement",async()=>{
    const {c}=await fixture(5,"SINGLE_ELIMINATION",4,1,true)
    await db.query("SELECT public.set_category_registration_status($1,'REGISTRATION_CLOSED')",[c])
    const bracket=await payload(c);expect(bracket.qualifier_count).toBe(5)
    await save(c,bracket);await db.query("SELECT public.publish_category_knockout_bracket($1)",[c])
    while(true){const pending=(await db.query<{id:string}>("SELECT id FROM public.matches WHERE category_id=$1 AND status='SCHEDULED'",[c])).rows;if(!pending.length)break;for(const m of pending)await finish(m.id)}
    const matches=(await db.query<{player_a_partner_id:string;player_b_partner_id:string}>("SELECT * FROM public.matches WHERE category_id=$1",[c])).rows
    expect(matches).toHaveLength(4);expect(matches.every((m)=>m.player_a_partner_id && m.player_b_partner_id)).toBe(true)
  })
  it("builds a three-qualifier knockout from three actual round-robin groups",async()=>{
    const {c}=await fixture(9,"ROUND_ROBIN",3)
    await db.query("SELECT public.set_category_registration_status($1,'REGISTRATION_CLOSED')",[c])
    const entries=(await db.query<{player_id:string;full_name:string}>("SELECT r.player_id,p.full_name FROM public.registrations r JOIN public.profiles p ON p.id=r.player_id WHERE r.category_id=$1 AND r.status='CONFIRMED' ORDER BY r.player_id",[c])).rows.map((r)=>({id:r.player_id,full_name:r.full_name}))
    const groups=distributePlayers(entries,3,()=>0.42)
    await db.query("SELECT public.save_category_draw_preview($1,$2::jsonb)",[c,JSON.stringify(groups)])
    await db.query("SELECT public.publish_category_draw($1)",[c])
    for(const m of (await db.query<{id:string}>("SELECT id FROM public.matches WHERE category_id=$1 ORDER BY group_round",[c])).rows)await finish(m.id)
    const qualifiers=(await db.query<{player_id:string}>(`SELECT DISTINCT ON(m.group_id) m.player_id FROM public.group_members m JOIN public.groups g ON g.id=m.group_id
      WHERE g.category_id=$1 ORDER BY m.group_id,m.standings_points DESC,m.net_points DESC,m.matches_won DESC,m.matches_lost,m.points_won DESC,m.player_id`,[c])).rows
    const bracket=await payload(c)
    bracket.qualifier_count=3;bracket.bracket_size=4;bracket.bye_count=1
    const seeds=qualifiers.map((e,i)=>({seed:i+1,groupName:"Group",place:1,playerId:e.player_id,playerName:e.player_id}))
    bracket.seeds=seeds.map((s)=>({seed:s.seed,group_name:s.groupName,place:s.place,player_id:s.playerId,player_name:s.playerName}))
    bracket.rounds=buildSeededBracket(seeds,3,()=>0.42).map((r)=>({round:r.round,label:r.label,pairings:r.pairings.map((p)=>({index:p.index,player_a_id:p.playerAId,player_b_id:p.playerBId,bye_player_id:p.byePlayerId,source_pairing_indexes:p.sourcePairingIndexes,match_id:null}))}))
    await db.exec("SAVEPOINT tied_boundary; RESET ROLE")
    await db.query("UPDATE public.group_members SET standings_points=0,net_points=0,matches_won=0,matches_lost=0,points_won=0 WHERE group_id IN(SELECT id FROM public.groups WHERE category_id=$1)",[c])
    await actor()
    try {await expect(save(c,bracket)).rejects.toMatchObject({code:"22023",message:expect.stringContaining("tie at the qualification boundary")})}
    finally {await db.exec("ROLLBACK TO SAVEPOINT tied_boundary; RELEASE SAVEPOINT tied_boundary")}
    await save(c,bracket);await db.query("SELECT public.publish_category_knockout_bracket($1)",[c])
    while(true){const pending=(await db.query<{id:string}>("SELECT id FROM public.matches WHERE category_id=$1 AND status='SCHEDULED'",[c])).rows;if(!pending.length)break;for(const m of pending)await finish(m.id)}
    expect((await db.query("SELECT id FROM public.matches WHERE category_id=$1 AND knockout_round IS NOT NULL",[c])).rows).toHaveLength(2)
  })
  it("cancels an unpublished elimination draw and allows a fresh roster after reopening",async()=>{
    const {c}=await fixture(3);await db.query("SELECT public.set_category_registration_status($1,'REGISTRATION_CLOSED')",[c])
    await save(c,await payload(c));await db.query("SELECT public.cancel_category_draw_preview($1)",[c])
    expect((await db.query("SELECT id FROM public.category_knockout_previews WHERE category_id=$1",[c])).rows).toHaveLength(0)
    await db.query("SELECT public.set_category_registration_status($1,'REGISTRATION_OPEN')",[c])
    await actor(id(20));await db.query("SELECT public.register_for_category($1)",[c])
    await actor();await db.query("SELECT public.set_category_registration_status($1,'REGISTRATION_CLOSED')",[c])
    const bracket=await payload(c);expect(bracket.qualifier_count).toBe(4);expect(bracket.bye_count).toBe(0)
    await save(c,bracket)
  })
  it("rejects draws before closing, insufficient entrants, duplicate entrants, bogus byes and injected later-round players",async()=>{
    const {c}=await fixture(5)
    const bracket=await payload(c)
    await denied(()=>save(c,bracket),"P0001")
    await db.query("SELECT public.set_category_registration_status($1,'REGISTRATION_CLOSED')",[c])
    const duplicate=structuredClone(bracket);duplicate.rounds[0].pairings[1].player_a_id=duplicate.rounds[0].pairings[0].player_a_id
    await denied(()=>save(c,duplicate))
    const bogus=structuredClone(bracket);bogus.rounds[0].pairings.find((p)=>p.bye_player_id)!.bye_player_id=id(49)
    await denied(()=>save(c,bogus))
    const injected=structuredClone(bracket);injected.rounds[1].pairings[0].player_a_id=id(49)
    await denied(()=>save(c,injected))
    for(const count of [0,1]) {const small=await fixture(count);await denied(()=>db.query("SELECT public.set_category_registration_status($1,'REGISTRATION_CLOSED')",[small.c]),"P0001")}
  })
  it("rechecks a preview against the current locked roster on publication and prevents duplicate publication",async()=>{
    const {c}=await fixture(5);await db.query("SELECT public.set_category_registration_status($1,'REGISTRATION_CLOSED')",[c])
    const bracket=await payload(c);await save(c,bracket)
    await db.exec("RESET ROLE");await db.query("UPDATE public.registrations SET status='WITHDRAWN' WHERE category_id=$1 AND player_id=$2",[c,id(10)])
    await actor();await denied(()=>db.query("SELECT public.publish_category_knockout_bracket($1)",[c]))
    await save(c,await payload(c));await db.query("SELECT public.publish_category_knockout_bracket($1)",[c])
    await denied(()=>db.query("SELECT public.publish_category_knockout_bracket($1)",[c]),"P0001")
    await actor(id(10));await denied(()=>db.query("SELECT public.publish_category_knockout_bracket($1)",[c]),"42501")
  })
})
