import { PGlite } from "@electric-sql/pglite"
import { readFileSync,readdirSync } from "node:fs"
import { afterAll,afterEach,beforeAll,beforeEach,describe,expect,it } from "vitest"
import { displayName } from "../lib/auth/organizational-roles"

let db:PGlite
const id = (n:number) => `30000000-0000-4000-8000-${String(n).padStart(12,"0")}`
const admin=id(1),mt=id(2),player=id(3),other=id(4),opponent=id(5),advisor=id(6)
const event=id(100),otherEvent=id(101),draft=id(102)
async function actor(user:string) {
  await db.exec("RESET ROLE")
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[user])
  await db.exec("SET ROLE authenticated")
}
async function denied(operation:() => Promise<unknown>,code="42501") {
  await db.exec("SAVEPOINT denied")
  try { await expect(operation()).rejects.toMatchObject({ code }) }
  finally { await db.exec("ROLLBACK TO SAVEPOINT denied; RELEASE SAVEPOINT denied") }
}
async function apply(user=player,tournament=event) {
  await actor(user)
  return (await db.query<{id:string}>("SELECT id FROM public.apply_for_tournament_ajk($1)",[tournament])).rows[0].id
}
async function approve(user=player,tournament=event) {
  const request=await apply(user,tournament)
  await actor(mt)
  await db.query("SELECT public.review_tournament_ajk($1,true)",[request])
  return request
}
async function match(tournament=event) {
  await db.exec("RESET ROLE")
  const category=(await db.query<{id:string}>("INSERT INTO public.categories(tournament_id,name,max_capacity,group_count,status) VALUES($1,'Singles',4,1,'DRAW_PUBLISHED') RETURNING id",[tournament])).rows[0].id
  return (await db.query<{id:string}>("INSERT INTO public.matches(category_id,player_a_id,player_b_id) VALUES($1,$2,$3) RETURNING id",[category,other,opponent])).rows[0].id
}
beforeAll(async () => {
  db=new PGlite()
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth TO authenticated,anon;
    CREATE TABLE auth.users(id UUID PRIMARY KEY,email TEXT,email_confirmed_at TIMESTAMPTZ,raw_user_meta_data JSONB DEFAULT '{}');
    CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE SQL STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::UUID $$;`)
  for (const file of readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort()) {
    try { await db.exec(readFileSync(`supabase/migrations/${file}`,"utf8")) }
    catch(error) { throw new Error(`Migration failed: ${file}`,{ cause:error }) }
  }
  for (let index=1;index<=6;index++) await db.query("INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES($1,$2,$3)",[id(index),`ajk-${index}@adab.umpsa.edu.my`,JSON.stringify({ full_name:`AJK test ${index}` })])
  await db.query("UPDATE public.profiles SET is_admin=true WHERE id=$1",[admin])
  await db.query("UPDATE public.profiles SET organizational_role='MT' WHERE id=$1",[mt])
  for (const tournament of [event,otherEvent,draft]) await db.query("INSERT INTO public.tournaments(id,title,location,court_count,start_date,end_date,status) VALUES($1,$2,'UMPSA',2,'2026-11-10','2026-11-11',$3)",[tournament,`Event ${tournament}`,tournament===draft ? "DRAFT" : "REGISTRATION_OPEN"])
},30000)
beforeEach(async () => { await db.exec("RESET ROLE; BEGIN") })
afterEach(async () => { await db.exec("ROLLBACK; RESET ROLE") })
afterAll(async () => { await db?.close() })

describe("tournament AJK applications and normalized roles",() => {
  it("backfills global roles, keeps every person a player, and denies direct escalation",async () => {
    await actor(mt)
    expect((await db.query<{role_code:string}>("SELECT role_code FROM public.user_roles WHERE user_id=$1 ORDER BY role_code",[mt])).rows.map((r) => r.role_code)).toEqual(["MT","PLAYER"])
    await actor(player)
    await denied(() => db.query("INSERT INTO public.user_roles(user_id,role_code,source) VALUES($1,'SYSTEM_ADMIN','PROFILE')",[player]))
    await denied(() => db.query("UPDATE public.roles SET label='Admin' WHERE code='PLAYER'"))
  })
  it("shows an application as pending with no AJK privilege and deduplicates submissions",async () => {
    const request=await apply()
    expect(await apply()).toBe(request)
    expect((await db.query<{user_role:string}>("SELECT user_role FROM public.current_user_access()")).rows[0].user_role).toBe("PLAYER")
    expect((await db.query("SELECT * FROM public.user_roles WHERE user_id=$1 AND role_code='AJK'",[player])).rows).toHaveLength(0)
    await actor(other)
    expect((await db.query("SELECT * FROM public.tournament_ajk_applications")).rows).toHaveLength(0)
    await denied(() => db.query("SELECT * FROM public.list_pending_tournament_ajk()"))
    await denied(() => db.query("SELECT public.review_tournament_ajk($1,true)",[request]))
  })
  it("allows MT to approve for exactly one tournament and updates Home display state",async () => {
    const request=await apply()
    await actor(mt)
    const pending=(await db.query<{id:string;tournament_title:string}>("SELECT * FROM public.list_pending_tournament_ajk()")).rows
    expect(pending[0]).toMatchObject({ id:request,tournament_title:`Event ${event}` })
    await db.query("SELECT public.review_tournament_ajk($1,true)",[request])
    expect((await db.query("SELECT * FROM public.list_pending_tournament_ajk()")).rows).toHaveLength(0)
    await actor(player)
    const profile=(await db.query<{user_role:string;organizational_role:string;tournament_ajk_ids:string[];full_name:string}>("SELECT * FROM public.current_user_access()")).rows[0]
    expect(profile).toMatchObject({ user_role:"AJK",organizational_role:"PLAYER",tournament_ajk_ids:[event],full_name:"AJK test 3" })
    expect(displayName(profile.full_name,profile.user_role)).toBe("(AJK) AJK test 3")
    await denied(() => db.query("INSERT INTO public.tournaments(title,location,court_count,start_date,end_date) VALUES('Forbidden','UMPSA',1,'2026-11-10','2026-11-11')"))
    await denied(() => db.query("SELECT * FROM public.list_pending_tournament_ajk()"))
  })
  it("rejects without granting roles, records history, and allows a later application",async () => {
    const request=await apply()
    await actor(mt); await db.query("SELECT public.review_tournament_ajk($1,false)",[request])
    await actor(player)
    expect((await db.query<{user_role:string}>("SELECT user_role FROM public.current_user_access()")).rows[0].user_role).toBe("PLAYER")
    expect(await apply()).not.toBe(request)
    expect((await db.query("SELECT * FROM public.tournament_ajk_applications WHERE user_id=$1",[player])).rows).toHaveLength(2)
  })
  it("blocks self-review, double decisions, and direct application writes",async () => {
    const ownRequest=await apply(mt)
    await denied(() => db.query("SELECT public.review_tournament_ajk($1,true)",[ownRequest]))
    await actor(admin); await db.query("SELECT public.review_tournament_ajk($1,false)",[ownRequest])
    await denied(() => db.query("SELECT public.review_tournament_ajk($1,true)",[ownRequest]),"P0001")
    await actor(player)
    await denied(() => db.query("INSERT INTO public.tournament_ajk_applications(user_id,tournament_id,status) VALUES($1,$2,'APPROVED')",[player,event]))
  })
  it("blocks applications for private drafts or finished events",async () => {
    await actor(player)
    await denied(() => db.query("SELECT public.apply_for_tournament_ajk($1)",[draft]),"P0002")
    await db.exec("RESET ROLE")
    await db.query("UPDATE public.tournaments SET status='COMPLETED' WHERE id=$1",[event])
    await actor(player)
    await denied(() => db.query("SELECT public.apply_for_tournament_ajk($1)",[event]),"22023")
  })
  it("restricts roster, assignment, and scoring eligibility to the approved tournament",async () => {
    await approve()
    const assignedMatch=await match(),unrelatedMatch=await match(otherEvent)
    await actor(mt)
    expect((await db.query<{id:string}>("SELECT * FROM public.tournament_officials($1)",[event])).rows.map((r) => r.id)).toContain(player)
    expect((await db.query<{id:string}>("SELECT * FROM public.tournament_officials($1)",[otherEvent])).rows.map((r) => r.id)).not.toContain(player)
    await db.query("SELECT public.assign_match_officials($1,$2,null)",[assignedMatch,player])
    await denied(() => db.query("SELECT public.assign_match_officials($1,$2,null)",[unrelatedMatch,player]),"22023")
    await actor(player)
    expect((await db.query<{authorized_umpire_match_ids:string[]}>("SELECT authorized_umpire_match_ids FROM public.current_user_access()")).rows[0].authorized_umpire_match_ids).toEqual([assignedMatch])
    await db.query("SELECT public.start_match($1)",[assignedMatch])
    await db.query("SELECT public.record_game_score($1,1,1,0)",[assignedMatch])
    expect((await db.query<{role_code:string}>("SELECT role_code FROM public.user_roles WHERE match_id=$1",[assignedMatch])).rows).toEqual([{ role_code:"UMPIRE" }])
    await denied(() => db.query("SELECT public.start_match($1)",[unrelatedMatch]))
  })
  it("keeps linesman duty separate from umpire scoring and removes replaced duties",async () => {
    await approve(); await approve(other)
    const assignedMatch=await match()
    await actor(mt)
    // 'other' is playing, so keep the approved player as the linesman only.
    await db.query("SELECT public.assign_match_officials($1,null,$2)",[assignedMatch,player])
    await actor(player)
    expect((await db.query<{authorized_linesman_match_ids:string[]}>("SELECT authorized_linesman_match_ids FROM public.current_user_access()")).rows[0].authorized_linesman_match_ids).toEqual([assignedMatch])
    await denied(() => db.query("SELECT public.start_match($1)",[assignedMatch]))
    await actor(mt); await db.query("SELECT public.assign_match_officials($1,null,null)",[assignedMatch])
    expect((await db.query("SELECT * FROM public.user_roles WHERE match_id=$1",[assignedMatch])).rows).toHaveLength(0)
  })
  it("allows a verified exact advisor email to bypass MT and removes bypass on email change",async () => {
    const request=await apply()
    await db.exec("RESET ROLE")
    // Fixture config stands in for the owner-supplied hardcoded email; no test identity is privileged in production.
    await db.exec("CREATE OR REPLACE FUNCTION private.backup_manager_email() RETURNS TEXT LANGUAGE SQL IMMUTABLE SET search_path='' AS $$ SELECT 'coach@umpsa.edu.my'::TEXT; $$")
    await db.query("UPDATE auth.users SET email='coach@umpsa.edu.my',email_confirmed_at=now() WHERE id=$1",[advisor])
    await actor(advisor)
    expect((await db.query<{is_admin:boolean}>("SELECT is_admin FROM public.current_user_access()")).rows[0].is_admin).toBe(true)
    await db.query("SELECT public.review_tournament_ajk($1,true)",[request])
    await db.query("INSERT INTO public.tournaments(title,location,court_count,start_date,end_date) VALUES('Backup created','UMPSA',1,'2026-11-10','2026-11-11')")
    await db.exec("RESET ROLE"); await db.query("UPDATE auth.users SET email='different@umpsa.edu.my' WHERE id=$1",[advisor])
    await actor(advisor)
    expect((await db.query<{is_admin:boolean}>("SELECT is_admin FROM public.current_user_access()")).rows[0].is_admin).toBe(false)
    await denied(() => db.query("SELECT * FROM public.list_pending_tournament_ajk()"))
  })
  it("does not trust unverified advisor addresses, profile emails, or user metadata",async () => {
    await db.exec("CREATE OR REPLACE FUNCTION private.backup_manager_email() RETURNS TEXT LANGUAGE SQL IMMUTABLE SET search_path='' AS $$ SELECT 'coach@umpsa.edu.my'::TEXT; $$")
    await db.query("UPDATE auth.users SET email='coach@umpsa.edu.my' WHERE id=$1",[advisor])
    await actor(advisor)
    expect((await db.query<{is_admin:boolean}>("SELECT is_admin FROM public.current_user_access()")).rows[0].is_admin).toBe(false)
    await db.exec("RESET ROLE")
    await db.query("UPDATE public.profiles SET email='coach@umpsa.edu.my' WHERE id=$1",[player])
    await db.query("UPDATE auth.users SET raw_user_meta_data=$1 WHERE id=$2",[JSON.stringify({ email:"coach@umpsa.edu.my",role:"SYSTEM_ADMIN",email_confirmed_at:"2026-11-09" }),player])
    await actor(player)
    expect((await db.query<{is_admin:boolean}>("SELECT is_admin FROM public.current_user_access()")).rows[0].is_admin).toBe(false)
  })
  it("rolls back approval and its role grant if the audit fails",async () => {
    const request=await apply()
    await db.exec("RESET ROLE")
    await db.exec(`CREATE FUNCTION public.fail_ajk_audit() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='TOURNAMENT_AJK_APPROVED' THEN RAISE EXCEPTION 'Test failure' USING ERRCODE='P0001'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER fail_ajk_audit BEFORE INSERT ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION public.fail_ajk_audit();`)
    await actor(mt)
    await denied(() => db.query("SELECT public.review_tournament_ajk($1,true)",[request]),"P0001")
    expect((await db.query<{status:string}>("SELECT status FROM public.tournament_ajk_applications WHERE id=$1",[request])).rows[0].status).toBe("PENDING")
    expect((await db.query("SELECT * FROM public.user_roles WHERE user_id=$1 AND source='APPLICATION'",[player])).rows).toHaveLength(0)
  })
  it("does not expose role grants or applications to anonymous clients",async () => {
    await db.exec("SET ROLE anon")
    await denied(() => db.query("SELECT * FROM public.user_roles"))
    await denied(() => db.query("SELECT * FROM public.tournament_ajk_applications"))
    await denied(() => db.query("SELECT public.apply_for_tournament_ajk($1)",[event]))
  })
})
