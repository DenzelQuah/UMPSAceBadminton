// docs/user-roles.md: approval is separate from tournament management and duties.
import { PGlite } from "@electric-sql/pglite"
import { readFileSync, readdirSync } from "node:fs"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest"

let db: PGlite
const id = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const admin = id(1), mt = id(2), exco = id(3), ajk = id(4), player = id(5), opponent = id(6)
async function actor(user: string) { await db.exec("RESET ROLE"); await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [user]); await db.exec("SET ROLE authenticated") }
async function request(user: string, role: string, detail = "Technical") {
  await actor(user)
  return (await db.query<{ id: string }>("SELECT id FROM public.submit_organization_role_request($1,$2)", [role, detail])).rows[0].id
}
async function approve(user: string, role: string, detail = "Technical") {
  const requestId = await request(user, role, detail)
  await actor(admin)
  await db.query("SELECT public.review_organization_role_request($1,true,'Verified organization appointment')", [requestId])
  return requestId
}
async function rejected(operation: () => Promise<unknown>, code = "42501") {
  await db.exec("SAVEPOINT denied")
  try { await expect(operation()).rejects.toMatchObject({ code }) }
  finally { await db.exec("ROLLBACK TO SAVEPOINT denied; RELEASE SAVEPOINT denied") }
}
async function matchFixture() {
  await db.exec("RESET ROLE")
  const tournament = (await db.query<{ id: string }>("INSERT INTO public.tournaments(title,location,court_count,start_date,end_date) VALUES('Role permissions','UMPSA',2,'2026-11-10','2026-11-11') RETURNING id")).rows[0].id
  const category = (await db.query<{ id: string }>("INSERT INTO public.categories(tournament_id,name,max_capacity,group_count,status) VALUES($1,'Singles',4,1,'DRAW_PUBLISHED') RETURNING id", [tournament])).rows[0].id
  const match = (await db.query<{ id: string }>("INSERT INTO public.matches(category_id,player_a_id,player_b_id) VALUES($1,$2,$3) RETURNING id", [category, player, opponent])).rows[0].id
  return { tournament, category, match }
}
beforeAll(async () => {
  db = new PGlite()
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth TO authenticated,anon;
    CREATE TABLE auth.users(id UUID PRIMARY KEY,email TEXT,raw_user_meta_data JSONB DEFAULT '{}');
    CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE SQL STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::UUID $$;`)
  for (const file of readdirSync("supabase/migrations").filter((file) => file.endsWith(".sql")).sort()) await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"))
  for (let index=1; index<=6; index++) await db.query("INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES($1,$2,$3)", [id(index), `role-${index}@adab.umpsa.edu.my`, JSON.stringify({ full_name: `Role test ${index}` })])
  await db.query("UPDATE public.profiles SET is_admin=true WHERE id=$1", [admin])
}, 30000)
beforeEach(async () => { await db.exec("RESET ROLE; BEGIN") })
afterEach(async () => { await db.exec("ROLLBACK; RESET ROLE") })
afterAll(async () => { await db?.close() })

describe("organization role approvals", () => {
  it("treats signup metadata as a pending request and never as approved access", async () => {
    const user = id(7)
    await db.query("INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES($1,'new-mt@adab.umpsa.edu.my',$2)", [user, JSON.stringify({ full_name: "MT applicant", requested_organizational_role: "MT", requested_role_detail: "President", is_admin: true, organizational_role: "MT" })])
    await actor(user)
    expect((await db.query("SELECT organizational_role,is_admin FROM public.current_actor_profile()")).rows[0]).toEqual({ organizational_role: "PLAYER", is_admin: false })
    expect((await db.query("SELECT requested_role,status FROM public.my_organization_role_requests()")).rows).toEqual([{ requested_role: "MT", status: "PENDING" }])
    await rejected(() => db.query("INSERT INTO public.tournaments(title,location,court_count,start_date,end_date) VALUES('Forbidden','UMPSA',1,'2026-11-10','2026-11-11')"))
  })
  it("only a platform administrator can approve, and records a complete audit", async () => {
    const requestId = await request(mt, "MT", "Vice President")
    await rejected(() => db.query("SELECT public.review_organization_role_request($1,true,'Self approval attempt')", [requestId]))
    await actor(admin)
    await db.query("SELECT public.review_organization_role_request($1,true,'Appointment checked by administrator')", [requestId])
    const audit = (await db.query<{ actor_id: string; original_data: { organizational_role: string }; new_data: { organizational_role: string } }>("SELECT * FROM public.audit_logs WHERE action='ORGANIZATION_ROLE_APPROVED' AND entity_id=$1", [mt])).rows[0]
    expect(audit.actor_id).toBe(admin)
    expect(audit.original_data.organizational_role).toBe("PLAYER")
    expect(audit.new_data.organizational_role).toBe("MT")
    await actor(mt)
    expect((await db.query("SELECT organizational_role,is_admin FROM public.current_actor_profile()")).rows[0]).toEqual({ organizational_role: "MT", is_admin: false })
    await rejected(() => db.query("UPDATE public.profiles SET is_admin=true WHERE id=$1", [mt]))
  })
  it("allows MT to manage tournaments and view drafts while keeping drafts private from players", async () => {
    await approve(mt, "MT", "Secretary")
    await actor(mt)
    const draft = (await db.query<{ id: string }>("INSERT INTO public.tournaments(title,location,court_count,start_date,end_date) VALUES('New private draft','UMPSA',1,'2026-11-10','2026-11-11') RETURNING id")).rows[0].id
    expect((await db.query("SELECT id FROM public.tournaments WHERE id=$1", [draft])).rows).toHaveLength(1)
    await actor(player)
    expect((await db.query("SELECT id FROM public.tournaments WHERE id=$1", [draft])).rows).toHaveLength(0)
    await actor(admin)
    expect((await db.query("SELECT id FROM public.tournaments WHERE id=$1", [draft])).rows).toHaveLength(1)
  })
  it("prevents MT from approving staff or bypassing approval through the old roster switch", async () => {
    await approve(mt, "MT")
    const staffRequest = await request(exco, "EXCO")
    await actor(mt)
    await rejected(() => db.query("SELECT public.review_organization_role_request($1,true,'MT tries approval')", [staffRequest]))
    await rejected(() => db.query("SELECT public.set_community_membership($1,true)", [player]))
    await rejected(() => db.query("SELECT * FROM public.list_organization_role_requests()"))
  })
  it("lets MT assign approved EXCO/AJK duties and limits scoring to the assigned umpire", async () => {
    await approve(mt, "MT")
    await approve(exco, "EXCO", "Multimedia")
    await approve(ajk, "AJK", "Part-time committee member")
    const fixture = await matchFixture()
    await actor(mt)
    const pool = (await db.query<{ id: string }>("SELECT * FROM public.available_officials()")).rows.map((r) => r.id)
    expect(pool).toContain(exco); expect(pool).toContain(ajk); expect(pool).not.toContain(player)
    await db.query("SELECT public.assign_match_officials($1,$2,$3)", [fixture.match, exco, ajk])
    await actor(ajk)
    await rejected(() => db.query("SELECT public.start_match($1)", [fixture.match]))
    await actor(exco)
    await db.query("SELECT public.start_match($1)", [fixture.match])
    await db.query("SELECT public.record_game_score($1,1,1,0)", [fixture.match])
    await rejected(() => db.query("INSERT INTO public.tournaments(title,location,court_count,start_date,end_date) VALUES('No staff management','UMPSA',1,'2026-11-10','2026-11-11')"))
  })
  it("rejects unapproved officials and self-officiating even for an approved member", async () => {
    await approve(mt, "MT")
    const fixture = await matchFixture()
    await actor(mt)
    await rejected(() => db.query("SELECT public.assign_match_officials($1,$2,null)", [fixture.match, exco]), "22023")
    await approve(player, "EXCO")
    await actor(mt)
    await rejected(() => db.query("SELECT public.assign_match_officials($1,$2,null)", [fixture.match, player]), "22023")
  })
  it("revokes scoring permission immediately despite an existing assignment", async () => {
    await approve(exco, "EXCO")
    const fixture = await matchFixture()
    await actor(admin)
    await db.query("SELECT public.assign_match_officials($1,$2,null)", [fixture.match, exco])
    await actor(exco); await db.query("SELECT public.start_match($1)", [fixture.match])
    await actor(admin); await db.query("SELECT public.revoke_organization_role($1,'Committee appointment has ended')", [exco])
    await actor(exco)
    expect((await db.query("SELECT organizational_role FROM public.current_actor_profile()")).rows[0]).toEqual({ organizational_role: "PLAYER" })
    await rejected(() => db.query("SELECT public.record_game_score($1,1,1,0)", [fixture.match]))
  })
  it("preserves rejected request history and allows a new pending application", async () => {
    const requestId = await request(exco, "EXCO", "Technical")
    await actor(admin); await db.query("SELECT public.review_organization_role_request($1,false,'Please confirm your appointment first')", [requestId])
    await request(exco, "AJK", "Part-time committee member")
    await request(exco, "EXCO", "Logistics")
    const requests = (await db.query<{ status: string }>("SELECT * FROM public.my_organization_role_requests()")).rows
    expect(requests.filter((r) => r.status === "PENDING")).toHaveLength(1)
    expect(requests.filter((r) => r.status === "REJECTED")).toHaveLength(1)
    await actor(player); expect((await db.query("SELECT * FROM public.organization_role_requests")).rows).toHaveLength(0)
  })
  it("rejects direct request/role writes and requests for administrator privilege", async () => {
    await actor(player)
    await rejected(() => db.query("SELECT public.submit_organization_role_request('ADMIN','Administrator')"), "22023")
    await rejected(() => db.query("UPDATE public.profiles SET organizational_role='MT' WHERE id=$1", [player]))
    await rejected(() => db.query("INSERT INTO public.organization_role_requests(user_id,requested_role,role_detail,status) VALUES($1,'MT','President','APPROVED')", [player]))
    await db.exec("RESET ROLE; SET ROLE anon")
    await rejected(() => db.query("SELECT * FROM public.organization_role_requests"))
  })
  it("rolls back role approval when its audit record cannot be saved", async () => {
    const requestId = await request(mt, "MT", "President")
    await db.exec("RESET ROLE")
    await db.exec(`CREATE FUNCTION public.fail_role_audit() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='ORGANIZATION_ROLE_APPROVED' THEN RAISE EXCEPTION 'Simulated audit failure' USING ERRCODE='P0001'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER fail_role_audit BEFORE INSERT ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION public.fail_role_audit();`)
    await actor(admin)
    await rejected(() => db.query("SELECT public.review_organization_role_request($1,true,'Verified appointment')", [requestId]), "P0001")
    expect((await db.query<{ status: string }>("SELECT status FROM public.organization_role_requests WHERE id=$1", [requestId])).rows[0].status).toBe("PENDING")
    await actor(mt)
    expect((await db.query<{ organizational_role: string }>("SELECT * FROM public.current_actor_profile()")).rows[0].organizational_role).toBe("PLAYER")
  })
})
