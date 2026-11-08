import { PGlite } from "@electric-sql/pglite"
import { readFileSync,readdirSync } from "node:fs"
import { afterAll,afterEach,beforeAll,beforeEach,describe,expect,it } from "vitest"
import type { LiveScore } from "../lib/realtime/live-scores"
let db:PGlite
const id=(n:number)=>`50000000-0000-4000-8000-${String(n).padStart(12,"0")}`
const admin=id(1),umpire=id(2),linesman=id(3),alice=id(4),bob=id(5)
async function actor(user=umpire){await db.exec("RESET ROLE");await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[user]);await db.exec("SET ROLE authenticated")}
async function denied(op:()=>Promise<unknown>,code="42501"){await db.exec("SAVEPOINT denied");try{await expect(op()).rejects.toMatchObject({code})}finally{await db.exec("ROLLBACK TO SAVEPOINT denied; RELEASE SAVEPOINT denied")}}
async function fixture(format="SINGLE_SET_1X30",state="DRAW_PUBLISHED"){
  await db.exec("RESET ROLE")
  const t=(await db.query<{id:string}>("INSERT INTO public.tournaments(title,location,court_count,start_date,end_date) VALUES('Live test','UMPSA',2,'2026-11-10','2026-11-11') RETURNING id")).rows[0].id
  const c=(await db.query<{id:string}>("INSERT INTO public.categories(tournament_id,name,max_capacity,group_count,format,status) VALUES($1,'Singles',4,1,$2,$3) RETURNING id",[t,format,state])).rows[0].id
  const m=(await db.query<{id:string}>("INSERT INTO public.matches(category_id,player_a_id,player_b_id,umpire_id,linesman_id,status) VALUES($1,$2,$3,$4,$5,'IN_PROGRESS') RETURNING id",[c,alice,bob,umpire,linesman])).rows[0].id
  await db.exec("DELETE FROM realtime.sent_events");await actor()
  return{t,c,m}
}
async function snapshot(match:string){return(await db.query<LiveScore>("SELECT * FROM public.live_match_scores WHERE match_id=$1",[match])).rows[0]}
async function point(match:string,delta=1,side="a",version?:number,operation=id(100),game=1){
  return(await db.query<LiveScore>("SELECT * FROM public.adjust_match_point($1,$2,$3,$4,$5,$6)",[match,game,side,delta,version ?? (await snapshot(match)).version,operation])).rows[0]
}
beforeAll(async()=>{
  db=new PGlite()
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth;GRANT USAGE ON SCHEMA auth TO authenticated,anon;
    CREATE TABLE auth.users(id UUID PRIMARY KEY,email TEXT,raw_user_meta_data JSONB DEFAULT '{}');
    CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE SQL STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::UUID $$;
    CREATE SCHEMA realtime;GRANT USAGE ON SCHEMA realtime TO authenticated;
    CREATE TABLE realtime.messages(extension TEXT);ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;GRANT SELECT ON realtime.messages TO authenticated;
    CREATE TABLE realtime.sent_events(payload JSONB,event TEXT,topic TEXT,private BOOLEAN);
    CREATE FUNCTION realtime.topic() RETURNS TEXT LANGUAGE SQL STABLE AS $$ SELECT current_setting('realtime.topic',true) $$;
    CREATE FUNCTION realtime.send(payload JSONB,event TEXT,topic TEXT,private BOOLEAN) RETURNS VOID LANGUAGE SQL AS $$ INSERT INTO realtime.sent_events VALUES(payload,event,topic,private) $$;`)
  for(const file of readdirSync("supabase/migrations").filter((f)=>f.endsWith(".sql")).sort())try{await db.exec(readFileSync(`supabase/migrations/${file}`,"utf8"))}catch(error){throw new Error(`Migration failed: ${file}`,{cause:error})}
  for(let n=1;n<=5;n++)await db.query("INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES($1,$2,$3)",[id(n),`live-${n}@adab.umpsa.edu.my`,JSON.stringify({full_name:`Live ${n}`})])
  await db.query("UPDATE public.profiles SET is_admin=true WHERE id=$1",[admin]);await db.query("UPDATE public.profiles SET organizational_role='EXCO' WHERE id=ANY($1::uuid[])",[[umpire,linesman]])
},30000)
beforeEach(async()=>{await db.exec("RESET ROLE; BEGIN")});afterEach(async()=>{await db.exec("ROLLBACK; RESET ROLE")});afterAll(async()=>{await db?.close()})
describe("transactional point synchronization",()=>{
  it("persists each increment/decrement immediately and emits one compact database-owned broadcast",async()=>{
    const {m,c}=await fixture();const first=await point(m)
    expect(first.games).toEqual([{gameNumber:1,playerAScore:1,playerBScore:0}])
    expect((await point(m,-1,"a",undefined,id(101))).games[0].playerAScore).toBe(0)
    await db.exec("RESET ROLE")
    const events=(await db.query<{payload:LiveScore;event:string;topic:string;private:boolean}>("SELECT * FROM realtime.sent_events")).rows
    expect(events).toHaveLength(2);expect(events[0]).toMatchObject({event:"score_changed",topic:`scores:category:${c}`,private:true})
    expect(events[1].payload.version).toBeGreaterThan(events[0].payload.version)
    expect(events[1].payload.games[0].playerAScore).toBe(0)
  })
  it("does not double count an operation retried after its response was lost",async()=>{
    const {m}=await fixture();const version=(await snapshot(m)).version
    await point(m,1,"a",version)
    expect((await point(m,1,"a",version)).games[0].playerAScore).toBe(1)
    await denied(()=>point(m,1,"b",version),"22023")
    await db.exec("RESET ROLE");expect((await db.query("SELECT * FROM realtime.sent_events")).rows).toHaveLength(1)
  })
  it("rejects stale commands from a second device without overwriting or incrementing the score",async()=>{
    const {m}=await fixture();const version=(await snapshot(m)).version
    await point(m,1,"a",version)
    await denied(()=>point(m,1,"b",version,id(101)),"40001")
    expect((await snapshot(m)).games[0]).toEqual({gameNumber:1,playerAScore:1,playerBScore:0})
  })
  it("limits writes to assigned approved umpires or management, with read-only access for players/linesmen",async()=>{
    const {m}=await fixture()
    for(const user of [alice,linesman]){await actor(user);await denied(()=>point(m))}
    await actor(admin);await point(m)
    await actor(alice);expect((await snapshot(m)).games[0].playerAScore).toBe(1)
    await denied(()=>db.query("UPDATE public.live_match_scores SET games='[]' WHERE match_id=$1",[m]))
    await denied(()=>db.query("INSERT INTO realtime.messages(extension) VALUES('broadcast')"))
  })
  it("does not expose draft match snapshots or allow a draft broadcast subscription to players",async()=>{
    const {m,c}=await fixture("SINGLE_SET_1X30","DRAFT")
    await actor(alice)
    expect(await snapshot(m)).toBeUndefined()
    expect((await db.query<{allowed:boolean}>("SELECT private.can_watch_score_topic($1) AS allowed",[`scores:category:${c}`])).rows[0].allowed).toBe(false)
    await actor(admin)
    expect((await db.query<{allowed:boolean}>("SELECT private.can_watch_score_topic($1) AS allowed",[`scores:category:${c}`])).rows[0].allowed).toBe(true)
  })
  it("permits a final-rally correction before sign-off, then locks the submitted result",async()=>{
    const {m}=await fixture()
    await db.query("SELECT public.record_game_score($1,1,30,29)",[m])
    expect((await point(m,-1)).games[0]).toEqual({gameNumber:1,playerAScore:29,playerBScore:29})
    await point(m,1,"a",undefined,id(101));await db.query("SELECT public.submit_match_result($1)",[m])
    await denied(()=>point(m,-1,"a",undefined,id(102)),"P0001")
    expect((await snapshot(m)).status).toBe("COMPLETED")
  })
  it("rejects negative scores, invalid deltas and edits to an earlier game after the next has started",async()=>{
    const {m}=await fixture("STANDARD_3X21")
    await denied(()=>point(m,-1),"22023");await denied(()=>point(m,2),"22023")
    await denied(()=>point(m,1,"a",undefined,id(101),2),"22023")
    await db.query("SELECT public.record_game_score($1,1,21,10)",[m]);await point(m,1,"a",undefined,id(102),2)
    await denied(()=>point(m,-1,"a",undefined,id(103),1),"P0001")
  })
  it("rolls back score, version, operation and broadcast if the audit fails",async()=>{
    const {m}=await fixture();const before=await snapshot(m)
    await db.exec("RESET ROLE")
    await db.exec(`CREATE FUNCTION public.fail_live_audit() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='MATCH_POINT_ADJUSTED' THEN RAISE EXCEPTION 'Audit failed' USING ERRCODE='P0001'; END IF;RETURN NEW;END $$;
      CREATE TRIGGER fail_live_audit BEFORE INSERT ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION public.fail_live_audit();`)
    await actor();await denied(()=>point(m),"P0001")
    expect(await snapshot(m)).toEqual(before)
    await db.exec("RESET ROLE");expect((await db.query("SELECT * FROM private.point_operations")).rows).toHaveLength(0);expect((await db.query("SELECT * FROM realtime.sent_events")).rows).toHaveLength(0)
  })
})
