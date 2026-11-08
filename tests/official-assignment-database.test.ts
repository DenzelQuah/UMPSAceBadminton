import { PGlite } from "@electric-sql/pglite"
import { readFileSync,readdirSync } from "node:fs"
import { afterAll,afterEach,beforeAll,beforeEach,describe,expect,it } from "vitest"
import type { MatchOfficialAssignment } from "../app/actions/officials"
import { BACKUP_MANAGER_EMAIL } from "../lib/auth/backup-manager"

let db:PGlite,event:string,category:string,otherEvent:string,otherCategory:string,match:string
const id=(n:number)=>`80000000-0000-4000-8000-${String(n).padStart(12,"0")}`
const admin=id(1),mt=id(2),exco=id(3),ajk=id(4),player=id(5),opponent=id(6),scoped=id(7),foreignAjk=id(8),otherA=id(9),otherB=id(10),backup=id(11)
async function actor(user:string){await db.exec("RESET ROLE");await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[user]);await db.exec("SET ROLE authenticated")}
async function denied(operation:()=>Promise<unknown>,code="42501"){
  await db.exec("SAVEPOINT denied")
  try{await expect(operation()).rejects.toMatchObject({code})}
  finally{await db.exec("ROLLBACK TO SAVEPOINT denied;RELEASE SAVEPOINT denied")}
}
async function availability(target=match){return(await db.query<{result:MatchOfficialAssignment}>("SELECT public.get_match_official_availability($1) AS result",[target])).rows[0].result}
async function assign(umpire:string | null,linesman:string | null=null,target=match){return db.query("SELECT * FROM public.assign_match_officials($1,$2,$3)",[target,umpire,linesman])}
async function fixture(time:string | null="2026-11-10T10:00:00Z",categoryId=category,a=player,b=opponent,umpire:string | null=null){
  return(await db.query<{id:string}>("INSERT INTO public.matches(category_id,player_a_id,player_b_id,scheduled_time,court_number,umpire_id) VALUES($1,$2,$3,$4,1,$5) RETURNING id",[categoryId,a,b,time,umpire])).rows[0].id
}
beforeAll(async()=>{
  db=new PGlite()
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth;GRANT USAGE ON SCHEMA auth TO authenticated,anon;
    CREATE TABLE auth.users(id UUID PRIMARY KEY,email TEXT,email_confirmed_at TIMESTAMPTZ,raw_user_meta_data JSONB DEFAULT '{}');
    CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE SQL STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::UUID $$;`)
  for(const file of readdirSync("supabase/migrations").filter((file)=>file.endsWith(".sql")).sort())await db.exec(readFileSync(`supabase/migrations/${file}`,"utf8"))
  for(let n=1;n<=11;n++)await db.query("INSERT INTO auth.users(id,email,email_confirmed_at,raw_user_meta_data) VALUES($1,$2,now(),$3)",[id(n),n===11 ? BACKUP_MANAGER_EMAIL : `assignment-${n}@adab.umpsa.edu.my`,JSON.stringify({full_name:`Member ${n}`})])
  await db.query("UPDATE public.profiles SET is_admin=true WHERE id=$1",[admin])
  for(const [user,role] of [[mt,"MT"],[exco,"EXCO"],[ajk,"AJK"]])await db.query("UPDATE public.profiles SET organizational_role=$1 WHERE id=$2",[role,user])
},30000)
beforeEach(async()=>{
  await db.exec("RESET ROLE;BEGIN")
  const events=(await db.query<{id:string}>("INSERT INTO public.tournaments(title,location,court_count,start_date,end_date,status) VALUES('Assignments','UMPSA',3,'2026-11-10','2026-11-11','DRAW_PUBLISHED'),('Other event','UMPSA',3,'2026-11-10','2026-11-11','DRAW_PUBLISHED') RETURNING id")).rows
  event=events[0].id;otherEvent=events[1].id
  category=(await db.query<{id:string}>("INSERT INTO public.categories(tournament_id,name,max_capacity,group_count,status) VALUES($1,'Singles',16,4,'DRAW_PUBLISHED') RETURNING id",[event])).rows[0].id
  otherCategory=(await db.query<{id:string}>("INSERT INTO public.categories(tournament_id,name,max_capacity,group_count,status) VALUES($1,'Singles',16,4,'DRAW_PUBLISHED') RETURNING id",[otherEvent])).rows[0].id
  await db.query("INSERT INTO public.user_roles(user_id,role_code,tournament_id,source) VALUES($1,'AJK',$2,'APPLICATION'),($3,'AJK',$4,'APPLICATION')",[scoped,event,foreignAjk,otherEvent])
  match=await fixture()
})
afterEach(async()=>{await db.exec("ROLLBACK;RESET ROLE")});afterAll(async()=>{await db?.close()})

describe("match official availability and assignment",()=>{
  it.each([mt,exco,admin,backup])("allows approved manager %s to fetch and save match duties",async(user)=>{
    await actor(user)
    const roster=(await availability()).officials
    expect(roster.map((person)=>person.id)).toEqual(expect.arrayContaining([mt,exco,ajk,scoped,backup]))
    expect(roster.map((person)=>person.id)).not.toContain(player)
    expect(roster.map((person)=>person.id)).not.toContain(foreignAjk)
    expect(roster.every((person)=>!("email" in person))).toBe(true)
    await assign(mt,ajk)
    expect((await availability()).match).toMatchObject({umpire_id:mt,linesman_id:ajk})
  })
  it.each([player,ajk,scoped])("denies member %s roster and assignment access even through a direct RPC",async(user)=>{
    await actor(user);await denied(()=>availability());await denied(()=>assign(exco,ajk))
    await denied(()=>db.query("SELECT private.match_official_assignment_context($1)",[match]))
    await denied(()=>db.query("SELECT * FROM private.assign_match_officials($1,$2,null)",[match,exco]))
  })
  it("does not give EXCO tournament administration, role approvals or arbitrary match updates",async()=>{
    await actor(exco);await assign(mt,ajk)
    await denied(()=>db.query("INSERT INTO public.tournaments(title,location,court_count,start_date,end_date) VALUES('Forbidden','UMPSA',1,'2026-11-10','2026-11-11')"))
    await denied(()=>db.query("SELECT * FROM public.list_pending_tournament_ajk()"))
    await denied(()=>db.query("UPDATE public.matches SET court_number=3 WHERE id=$1 RETURNING id",[match]))
    expect((await availability()).match.court_number).toBe(1)
  })
  it("marks overlapping duties across tournaments and across umpire/linesman slots unavailable",async()=>{
    const other=await fixture("2026-11-10T10:20:00Z",otherCategory,otherA,otherB)
    await actor(mt);await assign(null,ajk,other)
    const member=(await availability()).officials.find((person)=>person.id===ajk)
    expect(member).toMatchObject({available:false,unavailable_reason:"Unavailable: assigned to an overlapping match"})
    await denied(()=>assign(ajk),"P0001")
    expect((await availability()).match.umpire_id).toBeNull()
  })
  it("rechecks stale availability at save rather than trusting the earlier preview",async()=>{
    const other=await fixture("2026-11-10T10:00:00Z",otherCategory,otherA,otherB)
    await actor(exco);expect((await availability()).officials.find((p)=>p.id===ajk)?.available).toBe(true)
    await actor(mt);await assign(ajk,null,other)
    await actor(exco);await denied(()=>assign(null,ajk),"P0001")
  })
  it("uses half-open 40-minute duty slots so back-to-back matches remain available",async()=>{
    await fixture("2026-11-10T09:20:00Z",otherCategory,otherA,otherB,ajk)
    await actor(exco);expect((await availability()).officials.find((p)=>p.id===ajk)?.available).toBe(true)
    await assign(ajk)
  })
  it("excludes playing commitments within the 70-minute start-time buffer",async()=>{
    await fixture("2026-11-10T09:00:00Z",otherCategory,ajk,otherB)
    await actor(exco);expect((await availability()).officials.find((p)=>p.id===ajk)).toMatchObject({available:false,unavailable_reason:"Unavailable: playing or within the player rest buffer"})
    await denied(()=>assign(ajk),"P0001")
  })
  it("allows an official at the exact 70-minute player buffer boundary",async()=>{
    await fixture("2026-11-10T08:50:00Z",otherCategory,ajk,otherB)
    await actor(exco);expect((await availability()).officials.find((p)=>p.id===ajk)?.available).toBe(true);await assign(ajk)
  })
  it.each(["CANCELLED","POSTPONED"])("ignores %s fixtures in availability",async(status)=>{
    const other=await fixture("2026-11-10T10:00:00Z",otherCategory,otherA,otherB,ajk)
    await db.query("UPDATE public.matches SET status=$1 WHERE id=$2",[status,other])
    await actor(exco);expect((await availability()).officials.find((p)=>p.id===ajk)?.available).toBe(true);await assign(ajk)
  })
  it("keeps current officials selectable and synchronizes reassignment with duty roles and scoring",async()=>{
    await actor(exco);await assign(mt,ajk)
    expect((await availability()).officials.find((p)=>p.id===mt)?.available).toBe(true)
    await assign(exco,scoped)
    await db.exec("RESET ROLE")
    expect((await db.query("SELECT user_id,role_code FROM public.user_roles WHERE match_id=$1 ORDER BY role_code",[match])).rows).toEqual([{user_id:scoped,role_code:"LINESMAN"},{user_id:exco,role_code:"UMPIRE"}])
    expect((await db.query<{actor_id:string}>("SELECT actor_id FROM public.audit_logs WHERE action='MATCH_OFFICIALS_ASSIGNED' AND entity_id=$1",[match])).rows.every((row)=>row.actor_id===exco)).toBe(true)
    await actor(scoped);await denied(()=>db.query("SELECT public.start_match($1)",[match]))
    await actor(exco);await db.query("SELECT public.start_match($1)",[match])
    await db.query("SELECT public.record_game_score($1,1,1,0)",[match])
    expect((await db.query<{games:unknown[]}>("SELECT games FROM public.live_match_scores WHERE match_id=$1",[match])).rows[0].games).toEqual([{gameNumber:1,playerAScore:1,playerBScore:0}])
  })
  it("rejects same-person duties, unapproved users, self-officiating and AJK grants for another tournament",async()=>{
    await db.query("UPDATE public.profiles SET organizational_role='EXCO' WHERE id=$1",[player])
    await actor(exco)
    expect((await availability()).officials.find((p)=>p.id===player)).toMatchObject({available:false,unavailable_reason:"Playing in this match"})
    for(const [a,b] of [[ajk,ajk],[opponent,null],[player,null],[foreignAjk,null]])await denied(()=>assign(a,b),"22023")
  })
  it("locks assignments after a match starts or the tournament closes",async()=>{
    await actor(exco);await assign(exco)
    await db.query("SELECT public.start_match($1)",[match])
    expect((await availability()).match.locked).toBe(true);await denied(()=>assign(mt),"P0001")
    await db.exec("RESET ROLE");await db.query("UPDATE public.tournaments SET status='COMPLETED' WHERE id=$1",[event])
    await actor(exco);expect((await availability()).match.locked).toBe(true);await denied(()=>assign(null),"P0001")
  })
  it("does not expose unpublished draws to EXCO",async()=>{
    await db.query("UPDATE public.categories SET status='DRAW_GENERATED' WHERE id=$1",[category])
    await actor(exco);await denied(()=>availability(),"P0002");await denied(()=>assign(ajk),"P0002")
    await actor(mt);expect((await availability()).match.id).toBe(match)
  })
  it("allows provisional assignments without a time and rechecks when MT schedules them",async()=>{
    await db.query("UPDATE public.matches SET scheduled_time=NULL WHERE id=$1",[match])
    await fixture("2026-11-10T10:00:00Z",otherCategory,otherA,otherB,ajk)
    await actor(exco);await assign(ajk);expect((await availability()).match.scheduled_time).toBeNull()
    await actor(mt);await denied(()=>db.query("SELECT public.schedule_match($1,2,'2026-11-10T10:00:00Z',$2,null)",[match,ajk]),"P0001")
  })
  it("revokes a demoted EXCO's assignment authority immediately",async()=>{
    await db.query("UPDATE public.profiles SET organizational_role='PLAYER' WHERE id=$1",[exco])
    await actor(exco);await denied(()=>availability());await denied(()=>assign(ajk))
  })
  it("does not grant anonymous or sessionless access to the assignment RPCs",async()=>{
    for(const name of ["public.get_match_official_availability(uuid)","public.assign_match_officials(uuid,uuid,uuid)"]){
      expect((await db.query<{allowed:boolean}>("SELECT has_function_privilege('anon',$1,'EXECUTE') AS allowed",[name])).rows[0].allowed).toBe(false)
    }
    await actor("");await denied(()=>availability());await denied(()=>assign(ajk))
  })
})
