// docs/doubles-pairing.md: real PostgreSQL functions, triggers, grants and RLS.
import { PGlite } from "@electric-sql/pglite"
import { readFileSync, readdirSync } from "node:fs"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { buildSeededBracket } from "../lib/tournament/bracket"
import { orderQualifiers } from "../lib/tournament/qualification"

let db: PGlite
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const admin = id(1), alice = id(2), bob = id(3), carol = id(4), dan = id(5), outsider = id(6)
const tournament = id(100), category = id(200)

async function actor(user: string) {
  await db.exec("RESET ROLE")
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [user])
  await db.exec("SET ROLE authenticated")
}
async function invite(from: string, to: string) {
  await actor(from)
  const result = await db.query<{ id: string }>("SELECT public.invite_doubles_partner($1, $2) AS id", [category, `${to}@adab.umpsa.edu.my`])
  return result.rows[0].id
}
async function respond(user: string, invitation: string, response = "ACCEPT") {
  await actor(user)
  return db.query<{ status: string }>("SELECT public.respond_doubles_invitation($1, $2) AS status", [invitation, response])
}
async function pair(from: string, to: string) {
  const invitation = await invite(from, to)
  await respond(to, invitation)
}
async function publishedPairMatch() {
  await pair(alice, bob)
  await pair(carol, dan)
  await actor(admin)
  await db.query("SELECT public.set_category_registration_status($1, 'REGISTRATION_CLOSED')", [category])
  const groups = [{ name: "Group A", players: [
    { id: alice, full_name: `${alice} / ${bob}`, seed_number: null },
    { id: carol, full_name: `${carol} / ${dan}`, seed_number: null },
  ] }]
  await db.query("SELECT public.save_category_draw_preview($1,$2::jsonb)", [category, JSON.stringify(groups)])
  await db.query("SELECT public.publish_category_draw($1)", [category])
  const result = await db.query<{ id: string; player_a_partner_id: string; player_b_partner_id: string }>("SELECT * FROM public.matches WHERE category_id=$1", [category])
  return result.rows[0]
}
async function expectRejected(operation: () => Promise<unknown>, code: string) {
  // A savepoint lets later assertions verify that a rejected transaction saved nothing.
  await db.exec("SAVEPOINT rejection")
  try { await expect(operation()).rejects.toMatchObject({ code }) }
  finally { await db.exec("ROLLBACK TO SAVEPOINT rejection; RELEASE SAVEPOINT rejection") }
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth TO authenticated, anon;
    CREATE TABLE auth.users(id UUID PRIMARY KEY, email TEXT, raw_user_meta_data JSONB DEFAULT '{}');
    CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE SQL STABLE AS
      $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::UUID $$;
  `)
  for (const file of readdirSync("supabase/migrations").filter((file) => file.endsWith(".sql")).sort()) {
    try { await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8")) }
    catch (error) { throw new Error(`Migration failed: ${file}`, { cause: error }) }
  }
  for (let index = 1; index <= 17; index++) {
    const user = id(index)
    await db.query("INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES ($1,$2,$3)", [user, `${user}@adab.umpsa.edu.my`, JSON.stringify({ full_name: user })])
  }
  await db.query("UPDATE public.profiles SET is_admin = true WHERE id = $1", [admin])
  await db.query("INSERT INTO public.tournaments(id,title,location,court_count,start_date,end_date) VALUES($1,'Doubles test','UMPSA',4,'2026-11-10T08:00:00Z','2026-11-10T18:00:00Z')", [tournament])
  await actor(admin)
  const created = await db.query<{ id: string }>("SELECT id FROM public.create_doubles_category($1,'Doubles',4,1,1,'SINGLE_SET_1X30')", [tournament])
  await db.exec("RESET ROLE")
  await db.query("UPDATE public.categories SET id=$1, status='REGISTRATION_OPEN' WHERE id=$2", [category, created.rows[0].id])
}, 30000)
beforeEach(async () => { await db.exec("RESET ROLE; BEGIN") })
afterEach(async () => { await db.exec("ROLLBACK; RESET ROLE") })
afterAll(async () => { await db?.close() })

describe("doubles consent and squad eligibility", () => {
  it("restores only the documented test administrator and makes tournament creation available", async () => {
    const testAdministrator = id(99)
    await db.query("INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES($1,'codex-test-admin@umpsa.edu.my','{\"full_name\":\"Test Administrator\"}')", [testAdministrator])
    // The suite's outer transaction provides the same atomic boundary as the script.
    const restore = readFileSync("scripts/restore-test-admin.sql", "utf8").replace(/^BEGIN;\s*$/gm, "").replace(/^COMMIT;\s*$/gm, "")
    await db.exec(restore)
    await db.exec(restore)
    expect((await db.query<{ is_admin: boolean }>("SELECT is_admin FROM public.profiles WHERE id=$1", [testAdministrator])).rows[0].is_admin).toBe(true)
    expect((await db.query<{ is_admin: boolean }>("SELECT is_admin FROM public.profiles WHERE id=$1", [alice])).rows[0].is_admin).toBe(false)
    expect((await db.query("SELECT * FROM public.audit_logs WHERE action='TEST_ADMIN_ACCESS_RESTORED' AND entity_id=$1", [testAdministrator])).rows).toHaveLength(1)
    await actor(testAdministrator)
    expect((await db.query<{ is_admin: boolean }>("SELECT * FROM public.current_user_profile()")).rows[0].is_admin).toBe(true)
    const created = await db.query<{ title: string }>("INSERT INTO public.tournaments(title,location,court_count,start_date,end_date) VALUES('Restored administrator draft','UMPSA',2,'2026-11-10','2026-11-11') RETURNING title")
    expect(created.rows[0].title).toBe("Restored administrator draft")
  })
  it("blocks two main-squad players and prevents player-managed squad changes", async () => {
    await actor(admin)
    for (const user of [alice, bob]) await db.query("SELECT public.set_tournament_squad_member($1,$2,true)", [tournament, user])
    await actor(alice)
    await expectRejected(() => db.query("SELECT public.set_tournament_squad_member($1,$2,false)", [tournament, bob]), "42501")
    await expectRejected(() => invite(alice, bob), "22023")
    const rows = await db.query("SELECT * FROM public.doubles_invitations")
    expect(rows.rows).toHaveLength(0)
  })
  it("requires recipient consent and registers both players as one entry", async () => {
    const invitation = await invite(alice, bob)
    await expectRejected(() => respond(alice, invitation), "42501")
    await expectRejected(() => respond(outsider, invitation), "42501")
    expect((await respond(bob, invitation)).rows[0].status).toBe("CONFIRMED")
    const rows = await db.query<{ player_id: string; partner_id: string }>("SELECT * FROM public.get_my_registrations()")
    expect(rows.rows).toHaveLength(1)
    expect(rows.rows[0]).toMatchObject({ player_id: alice, partner_id: bob })
    await expectRejected(() => respond(bob, invitation), "P0001")
  })
  it("allows one main-squad athlete with a non-squad partner", async () => {
    await actor(admin)
    await db.query("SELECT public.set_tournament_squad_member($1,$2,true)", [tournament, alice])
    await pair(alice, bob)
    expect((await db.query("SELECT * FROM public.get_my_registrations()")).rows).toHaveLength(1)
    await actor(admin)
    const audit = await db.query<{ original_data: { enabled: boolean }; new_data: { enabled: boolean } }>("SELECT original_data, new_data FROM public.audit_logs WHERE action='MAIN_SQUAD_UPDATED' AND entity_id=$1", [tournament])
    expect(audit.rows[0].original_data.enabled).toBe(false)
    expect(audit.rows[0].new_data.enabled).toBe(true)
  })
  it("rechecks squad membership at acceptance and rejects invalidating roster edits", async () => {
    const invitation = await invite(alice, bob)
    await actor(admin)
    for (const user of [alice, bob]) await db.query("SELECT public.set_tournament_squad_member($1,$2,true)", [tournament, user])
    await expectRejected(() => respond(bob, invitation), "22023")
    await actor(admin)
    await db.query("SELECT public.set_tournament_squad_member($1,$2,false)", [tournament, bob])
    await respond(bob, invitation)
    await actor(admin)
    await expectRejected(() => db.query("SELECT public.set_tournament_squad_member($1,$2,true)", [tournament, bob]), "22023")
  })
  it("prevents reverse duplicate invitations, self-pairing and multiple entries", async () => {
    await expectRejected(() => invite(alice, alice), "22023")
    const invitation = await invite(alice, bob)
    await expectRejected(() => invite(bob, alice), "23505")
    await respond(bob, invitation)
    await expectRejected(() => invite(bob, carol), "23505")
  })
  it("supports decline, cancellation and withdrawal by either partner", async () => {
    await respond(bob, await invite(alice, bob), "DECLINE")
    await respond(alice, await invite(alice, bob), "CANCEL")
    await pair(alice, bob)
    const rows = await db.query<{ id: string }>("SELECT * FROM public.get_my_registrations()")
    await db.query("SELECT public.withdraw_registration($1)", [rows.rows[0].id])
    await pair(bob, carol)
    expect((await db.query<{ status: string }>("SELECT * FROM public.get_my_registrations()")).rows[0].status).toBe("CONFIRMED")
  })
  it("puts accepted pairs on the waitlist when entry capacity is full", async () => {
    await pair(alice, bob)
    await pair(carol, dan)
    await pair(outsider, id(7))
    await pair(id(8), id(9))
    const result = await respond(id(11), await invite(id(10), id(11)))
    expect(result.rows[0].status).toBe("WAITLISTED")
  })
  it("hides invitations from outsiders and denies direct table writes", async () => {
    await invite(alice, bob)
    await actor(outsider)
    expect((await db.query("SELECT * FROM public.doubles_invitations")).rows).toHaveLength(0)
    await expectRejected(() => db.query("INSERT INTO public.tournament_squad_members VALUES($1,$2)", [tournament, outsider]), "42501")
    await expectRejected(() => db.query("INSERT INTO public.doubles_invitations(category_id,inviter_id,partner_id) VALUES($1,$2,$3)", [category, outsider, dan]), "42501")
  })
  it("publishes a pair draw, scores it and awards both partners equal rankings once", async () => {
    const match = await publishedPairMatch()
    expect(match.player_a_partner_id).toBe(bob)
    expect(match.player_b_partner_id).toBe(dan)
    await db.query("SELECT public.schedule_match($1, 1, '2026-11-10T10:00:00Z', $2, null)", [match.id, admin])
    await db.query("SELECT public.start_match($1)", [match.id])
    await db.query("SELECT public.record_game_score($1, 1, 30, 29)", [match.id])
    await db.query("SELECT public.submit_match_result($1)", [match.id])
    await db.query("SELECT public.complete_tournament($1)", [tournament])
    const first = await db.query<{ profile_id: string; ranking_points: number }>("SELECT * FROM public.global_rankings ORDER BY profile_id")
    expect(first.rows.map((r) => [r.profile_id, r.ranking_points])).toEqual([[alice, 5], [bob, 5], [carol, 1], [dan, 1]])
    await db.query("SELECT public.complete_tournament($1)", [tournament])
    expect((await db.query("SELECT * FROM public.global_rankings ORDER BY profile_id")).rows).toEqual(first.rows)
  })
  it("rejects partner self-officiating and freezes pairing/squad edits after the draw", async () => {
    const match = await publishedPairMatch()
    await expectRejected(() => db.query("SELECT public.assign_match_officials($1,$2,null)", [match.id, bob]), "22023")
    await expectRejected(() => db.query("SELECT public.set_tournament_squad_member($1,$2,true)", [tournament, bob]), "P0001")
    await actor(bob)
    const registrations = await db.query<{ id: string }>("SELECT * FROM public.get_my_registrations()")
    await expectRejected(() => db.query("SELECT public.withdraw_registration($1)", [registrations.rows[0].id]), "P0001")
    const entries = await db.query<{ display_name: string }>("SELECT * FROM public.get_category_entries(ARRAY[$1::uuid])", [category])
    expect(entries.rows.some((r) => r.display_name === `${alice} / ${bob}`)).toBe(true)
  })
  it("detects a doubles partner's conflicting singles match and rest window", async () => {
    const match = await publishedPairMatch()
    await db.exec("RESET ROLE")
    const singlesCategory = await db.query<{ id: string }>("INSERT INTO public.categories(tournament_id,name,max_capacity,group_count) VALUES($1,'Singles conflict',4,1) RETURNING id", [tournament])
    await db.query("INSERT INTO public.matches(category_id,player_a_id,player_b_id,court_number,scheduled_time) VALUES($1,$2,$3,2,'2026-11-10T10:00:00Z')", [singlesCategory.rows[0].id, bob, outsider])
    await actor(admin)
    await expectRejected(() => db.query("SELECT public.schedule_match($1,1,'2026-11-10T10:20:00Z',null,null)", [match.id]), "P0001")
    await expectRejected(() => db.query("SELECT public.schedule_match($1,1,'2026-11-10T10:50:00Z',null,null)", [match.id]), "P0001")
    await db.query("SELECT public.schedule_match($1,1,'2026-11-10T11:00:00Z',null,null)", [match.id])
    expect((await db.query<{ scheduled_time: Date }>("SELECT scheduled_time FROM public.matches WHERE id=$1", [match.id])).rows[0].scheduled_time.toISOString()).toBe("2026-11-10T11:00:00.000Z")
  })
  it("enforces the official-duty buffer for the second doubles partner", async () => {
    const match = await publishedPairMatch()
    await db.exec("RESET ROLE")
    const singles = await db.query<{ id: string }>("INSERT INTO public.categories(tournament_id,name,max_capacity,group_count) VALUES($1,'Official buffer',4,1) RETURNING id", [tournament])
    await db.query("INSERT INTO public.matches(category_id,player_a_id,player_b_id,umpire_id,court_number,scheduled_time) VALUES($1,$2,$3,$4,2,'2026-11-10T10:00:00Z')", [singles.rows[0].id, outsider, id(7), bob])
    await actor(admin)
    await expectRejected(() => db.query("SELECT public.schedule_match($1,1,'2026-11-10T11:00:00Z',null,null)", [match.id]), "P0001")
    await db.query("SELECT public.schedule_match($1,1,'2026-11-10T11:10:00Z',null,null)", [match.id])
    expect((await db.query<{ scheduled_time: Date }>("SELECT scheduled_time FROM public.matches WHERE id=$1", [match.id])).rows[0].scheduled_time.toISOString()).toBe("2026-11-10T11:10:00.000Z")
  })
  it("advances paired entries through quarter-finals, semi-finals and final with stable side ordering", async () => {
    await db.query("UPDATE public.categories SET max_capacity=8, group_count=4, target_group_size=2, qualifiers_per_group=2 WHERE id=$1", [category])
    const groups = []
    const seeds = []
    for (let groupIndex = 0; groupIndex < 4; groupIndex++) {
      const players = []
      for (let place = 1; place <= 2; place++) {
        const representative = id(2 + groupIndex * 4 + (place - 1) * 2)
        const partner = id(3 + groupIndex * 4 + (place - 1) * 2)
        await pair(representative, partner)
        players.push({ id: representative, full_name: `${representative} / ${partner}`, seed_number: null })
        seeds.push({ seed: 0, groupName: `Group ${String.fromCharCode(65 + groupIndex)}`, place, playerId: representative, playerName: `${representative} / ${partner}` })
      }
      groups.push({ name: `Group ${String.fromCharCode(65 + groupIndex)}`, players })
    }
    await actor(admin)
    await db.query("SELECT public.set_category_registration_status($1,'REGISTRATION_CLOSED')", [category])
    await db.query("SELECT public.save_category_draw_preview($1,$2::jsonb)", [category, JSON.stringify(groups)])
    // Even while the draw is private, the second partner can still see their category.
    await actor(bob)
    expect((await db.query("SELECT * FROM public.categories WHERE id=$1", [category])).rows).toHaveLength(1)
    expect((await db.query("SELECT * FROM public.matches WHERE category_id=$1", [category])).rows).toHaveLength(0)
    await actor(admin)
    await db.query("SELECT public.publish_category_draw($1)", [category])
    const finish = async (matchId: string) => {
      await db.query("SELECT public.start_match($1)", [matchId])
      await db.query("SELECT public.record_game_score($1,1,30,10)", [matchId])
      await db.query("SELECT public.submit_match_result($1)", [matchId])
    }
    for (const match of (await db.query<{ id: string }>("SELECT id FROM public.matches WHERE category_id=$1", [category])).rows) await finish(match.id)
    const ordered = orderQualifiers(seeds)
    const rounds = buildSeededBracket(ordered)
    const payload = { qualifier_count: 8,
      seeds: ordered.map((s) => ({ seed: s.seed, group_name: s.groupName, place: s.place, player_id: s.playerId, player_name: s.playerName })),
      rounds: rounds.map((r) => ({ round: r.round, label: r.label, pairings: r.pairings.map((p) => ({ index: p.index, player_a_id: p.playerAId, player_b_id: p.playerBId, source_pairing_indexes: p.sourcePairingIndexes, match_id: null })) })),
    }
    await db.query("SELECT public.save_category_knockout_preview($1,8,$2::jsonb)", [category, JSON.stringify(payload)])
    await db.query("SELECT public.publish_category_knockout_bracket($1)", [category])
    const published = await db.query<{ bracket_payload: typeof payload }>("SELECT bracket_payload FROM public.category_knockout_previews WHERE category_id=$1", [category])
    const firstRound = published.rows[0].bracket_payload.rounds[0].pairings
    await finish(firstRound[1].match_id!)
    await finish(firstRound[0].match_id!)
    const semi = await db.query<{ player_a_id: string; player_b_id: string; player_a_partner_id: string }>("SELECT * FROM public.matches WHERE category_id=$1 AND knockout_round=2", [category])
    expect(semi.rows[0]).toMatchObject({ player_a_id: firstRound[0].player_a_id, player_b_id: firstRound[1].player_a_id, player_a_partner_id: bob })
    await finish(firstRound[2].match_id!)
    await finish(firstRound[3].match_id!)
    for (const match of (await db.query<{ id: string }>("SELECT id FROM public.matches WHERE category_id=$1 AND knockout_round=2 ORDER BY player_a_id DESC", [category])).rows) await finish(match.id)
    const final = (await db.query<{ id: string; player_a_id: string }>("SELECT * FROM public.matches WHERE category_id=$1 AND knockout_round=3", [category])).rows[0]
    expect(final.player_a_id).toBe(alice)
    await finish(final.id)
    await db.query("SELECT public.complete_tournament($1)", [tournament])
    const champions = await db.query<{ ranking_points: number }>("SELECT ranking_points FROM public.global_rankings WHERE profile_id=ANY($1::uuid[])", [[alice, bob]])
    expect(champions.rows.map((r) => r.ranking_points)).toEqual([20, 20])
  })
})
