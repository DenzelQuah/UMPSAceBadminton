// docs/ranking-system.md §§2–5: real PostgreSQL aggregation, publication and tie-breaks.
import { PGlite } from "@electric-sql/pglite"
import { readFileSync, readdirSync } from "node:fs"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest"

let db: PGlite
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const admin = id(1), alice = id(2), bob = id(3), carol = id(4), dan = id(5), erin = id(6)
type Row = { rank_position: number; profile_id: string; ranking_points: number; net_points: number;
  matches_played: number; matches_won: number; matches_lost: number; games_won: number;
  points_won: number; points_lost: number; participations: number; win_percentage: number; recent_form: string[] }

async function actor(user: string) {
  await db.exec("RESET ROLE")
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [user])
  await db.exec("SET ROLE authenticated")
}
async function standings() {
  await actor(alice)
  const result = await db.query<Row>("SELECT * FROM public.get_league_standings()")
  return result.rows.map((r) => ({ ...r, rank_position: Number(r.rank_position), win_percentage: Number(r.win_percentage) }))
}
async function setup(format = "SINGLE_SET_1X30", doubles = false, players = [alice, bob]) {
  await db.exec("RESET ROLE")
  const t = (await db.query<{ id: string }>("INSERT INTO public.tournaments(title,location,court_count,start_date,end_date) VALUES('League test','UMPSA',4,'2026-11-10T08:00:00Z','2026-11-11T18:00:00Z') RETURNING id")).rows[0].id
  const c = (await db.query<{ id: string }>("INSERT INTO public.categories(tournament_id,name,max_capacity,group_count,format,status,participation_format) VALUES($1,'League singles or doubles',16,1,$2,'REGISTRATION_OPEN',$3) RETURNING id", [t, format, doubles ? "DOUBLES" : "SINGLES"])).rows[0].id
  for (let index = 0; index < players.length; index += doubles ? 2 : 1) {
    await db.query("INSERT INTO public.registrations(category_id,player_id,partner_id,status) VALUES($1,$2,$3,'CONFIRMED')", [c, players[index], doubles ? players[index + 1] : null])
  }
  await db.query("UPDATE public.categories SET status='DRAW_PUBLISHED' WHERE id=$1", [c])
  return { tournament: t, category: c }
}
async function result(category: string, a: string, b: string, scores = [[30, 20]], status = "COMPLETED", time = "2026-11-10T09:00:00Z") {
  await db.exec("RESET ROLE")
  const match = (await db.query<{ id: string }>("INSERT INTO public.matches(category_id,player_a_id,player_b_id,scheduled_time) VALUES($1,$2,$3,$4) RETURNING id", [category, a, b, time])).rows[0].id
  await actor(admin)
  if (status === "COMPLETED") {
    await db.query("SELECT public.start_match($1)", [match])
    for (let i = 0; i < scores.length; i++) await db.query("SELECT public.record_game_score($1,$2,$3,$4)", [match, i + 1, ...scores[i]])
    await db.query("SELECT public.submit_match_result($1)", [match])
  } else {
    const winsA = scores.filter(([aScore, bScore]) => aScore > bScore).length
    const winner = winsA > scores.length / 2 ? a : b
    const payload = scores.map(([aScore, bScore], i) => ({ game_number: i + 1, player_a_score: aScore, player_b_score: bScore }))
    await db.query("SELECT public.override_match_result($1,$2,$3,$4::jsonb,'Verified tournament referee decision')", [match, status, winner, JSON.stringify(payload)])
  }
  return match
}
async function publish(tournament: string) {
  await actor(admin)
  await db.query("SELECT public.complete_tournament($1)", [tournament])
}
async function rejection(operation: () => Promise<unknown>, code = "42501") {
  await db.exec("SAVEPOINT forbidden")
  try { await expect(operation()).rejects.toMatchObject({ code }) }
  finally { await db.exec("ROLLBACK TO SAVEPOINT forbidden; RELEASE SAVEPOINT forbidden") }
}

async function createDatabase(includeLeague = true) {
  const database = new PGlite()
  await database.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth TO authenticated, anon;
    CREATE TABLE auth.users(id UUID PRIMARY KEY, email TEXT, raw_user_meta_data JSONB DEFAULT '{}');
    CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE SQL STABLE AS
      $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::UUID $$;
  `)
  for (const file of readdirSync("supabase/migrations").filter((file) => file.endsWith(".sql") && (includeLeague || !file.endsWith("_league_standings.sql"))).sort()) await database.exec(readFileSync(`supabase/migrations/${file}`, "utf8"))
  for (const [index, name] of ["Admin", "Alice", "Bob", "Carol", "Dan", "Erin"].entries()) {
    await database.query("INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES($1,$2,$3)", [id(index + 1), `${name}@adab.umpsa.edu.my`, JSON.stringify({ full_name: name })])
  }
  await database.query("UPDATE public.profiles SET is_admin=true WHERE id=$1", [admin])
  return database
}
beforeAll(async () => { db = await createDatabase() }, 30000)
beforeEach(async () => { await db.exec("RESET ROLE; BEGIN") })
afterEach(async () => { await db.exec("ROLLBACK; RESET ROLE") })
afterAll(async () => { await db?.close() })

describe("league entrants and published ranking points", () => {
  it("backfills a previously completed tournament when upgrading an existing database", async () => {
    const legacy = await createDatabase(false)
    try {
      const tournament = (await legacy.query<{ id: string }>("INSERT INTO public.tournaments(title,location,court_count,start_date,end_date) VALUES('Existing tournament','UMPSA',1,'2026-10-01','2026-10-02') RETURNING id")).rows[0].id
      const category = (await legacy.query<{ id: string }>("INSERT INTO public.categories(tournament_id,name,max_capacity,group_count,format,status) VALUES($1,'Existing singles',4,1,'STANDARD_3X21','REGISTRATION_OPEN') RETURNING id", [tournament])).rows[0].id
      for (const player of [alice, bob]) await legacy.query("INSERT INTO public.registrations(category_id,player_id,status) VALUES($1,$2,'CONFIRMED')", [category, player])
      const match = (await legacy.query<{ id: string }>("INSERT INTO public.matches(category_id,player_a_id,player_b_id) VALUES($1,$2,$3) RETURNING id", [category, alice, bob])).rows[0].id
      await legacy.query("INSERT INTO public.match_games(match_id,game_number,player_a_score,player_b_score) VALUES($1,1,21,15),($1,2,21,10)", [match])
      await legacy.query("UPDATE public.matches SET status='COMPLETED',winner_id=$1 WHERE id=$2", [alice, match])
      await legacy.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [admin])
      await legacy.query("SELECT public.complete_tournament($1)", [tournament])
      const before = (await legacy.query("SELECT rankings_processed_at FROM public.tournaments WHERE id=$1", [tournament])).rows
      await legacy.exec(readFileSync("supabase/migrations/20261105093718_league_standings.sql", "utf8"))
      const rows = (await legacy.query<Row>("SELECT * FROM public.get_league_standings()")).rows
      expect(rows.find((r) => r.profile_id === alice)).toMatchObject({ ranking_points: 6, games_won: 2, points_won: 42, points_lost: 25, net_points: 17, participations: 1 })
      expect((await legacy.query("SELECT rankings_processed_at FROM public.tournaments WHERE id=$1", [tournament])).rows).toEqual(before)
    } finally { await legacy.close() }
  }, 30000)
  it("lists registered players once at zero before any published result, including waitlist and withdrawal history", async () => {
    const first = await setup(undefined, false, [alice, bob, carol, dan])
    await setup(undefined, false, [alice, bob])
    await db.query("UPDATE public.registrations SET status='WAITLISTED' WHERE category_id=$1 AND player_id=$2", [first.category, carol])
    await db.query("UPDATE public.registrations SET status='WITHDRAWN' WHERE category_id=$1 AND player_id=$2", [first.category, dan])
    const rows = await standings()
    expect(rows.map((r) => r.profile_id).sort()).toEqual([alice, bob, carol, dan].sort())
    expect(rows.every((r) => r.ranking_points === 0 && r.matches_played === 0 && r.rank_position === 1 && r.recent_form.length === 0)).toBe(true)
  })
  it("holds match results at zero until tournament completion and publishes all counters exactly once", async () => {
    const t = await setup("STANDARD_3X21")
    await result(t.category, alice, bob, [[21, 15], [18, 21], [21, 19]])
    expect((await standings()).every((r) => r.ranking_points === 0 && r.matches_played === 0)).toBe(true)
    await publish(t.tournament)
    const rows = await standings()
    expect(rows[0]).toMatchObject({ profile_id: alice, ranking_points: 6, matches_played: 1, matches_won: 1, matches_lost: 0, games_won: 2, points_won: 60, points_lost: 55, net_points: 5, participations: 1, win_percentage: 100, recent_form: ["W"] })
    expect(rows[1]).toMatchObject({ profile_id: bob, ranking_points: 2, games_won: 1, net_points: -5, matches_lost: 1, win_percentage: 0, recent_form: ["L"] })
    await publish(t.tournament)
    expect(await standings()).toEqual(rows)
  })
  it("applies single-game points and awards every doubles athlete individually", async () => {
    const t = await setup(undefined, true, [alice, bob, carol, dan])
    await result(t.category, alice, carol, [[30, 29]])
    await publish(t.tournament)
    const rows = await standings()
    for (const player of [alice, bob]) expect(rows.find((r) => r.profile_id === player)).toMatchObject({ rank_position: 1, ranking_points: 5, games_won: 1, net_points: 1, points_won: 30, points_lost: 29, participations: 1 })
    for (const player of [carol, dan]) expect(rows.find((r) => r.profile_id === player)).toMatchObject({ rank_position: 3, ranking_points: 1, matches_lost: 1, net_points: -1 })
  })
  it.each([
    ["STANDARD_3X21", [[21, 0], [21, 0]], 6, 42, 2],
    ["SINGLE_SET_1X30", [[30, 0]], 5, 30, 1],
  ])("handles %s walkovers without giving the absentee participation points", async (format, scores, rp, np, games) => {
    const t = await setup(format)
    await result(t.category, alice, bob, scores, "WALKOVER")
    await publish(t.tournament)
    const rows = await standings()
    expect(rows[0]).toMatchObject({ ranking_points: rp, net_points: np, games_won: games, participations: 1, matches_won: 1 })
    expect(rows[1]).toMatchObject({ ranking_points: 0, net_points: -np, games_won: 0, participations: 0, matches_played: 1, matches_lost: 1 })
  })
  it("keeps a retiring player's actual game win and participation credit", async () => {
    const t = await setup("STANDARD_3X21")
    await result(t.category, alice, bob, [[15, 21], [21, 10], [21, 0]], "RETIRED")
    await publish(t.tournament)
    const rows = await standings()
    expect(rows[0]).toMatchObject({ ranking_points: 6, games_won: 2, points_won: 57, points_lost: 31, net_points: 26 })
    expect(rows[1]).toMatchObject({ ranking_points: 2, games_won: 1, participations: 1, points_won: 31, points_lost: 57, net_points: -26 })
  })
  it("accumulates across tournaments and keeps results after tournament archival", async () => {
    const first = await setup()
    await result(first.category, alice, bob)
    await publish(first.tournament)
    await actor(admin)
    await db.query("SELECT public.archive_tournament($1)", [first.tournament])
    const second = await setup()
    await result(second.category, alice, bob, [[30, 29]], "COMPLETED", "2026-11-11T09:00:00Z")
    await publish(second.tournament)
    expect((await standings())[0]).toMatchObject({ ranking_points: 10, matches_played: 2, matches_won: 2, games_won: 2, participations: 2, net_points: 11, recent_form: ["W", "W"] })
  })
  it("rolls back completion and every ranking counter when one write fails", async () => {
    const t = await setup()
    await result(t.category, alice, bob)
    await db.exec("RESET ROLE")
    await db.exec(`CREATE FUNCTION public.reject_test_ranking() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Simulated storage failure' USING ERRCODE='P0001'; END $$;
      CREATE TRIGGER reject_test_ranking BEFORE INSERT ON public.global_rankings FOR EACH ROW EXECUTE FUNCTION public.reject_test_ranking();`)
    await actor(admin)
    await rejection(() => db.query("SELECT public.complete_tournament($1)", [t.tournament]), "P0001")
    const tournament = (await db.query<{ status: string; rankings_processed_at: Date | null }>("SELECT status,rankings_processed_at FROM public.tournaments WHERE id=$1", [t.tournament])).rows[0]
    expect(tournament.rankings_processed_at).toBeNull()
    expect(tournament.status).not.toBe("COMPLETED")
    expect((await db.query("SELECT * FROM public.global_rankings")).rows).toHaveLength(0)
    expect((await standings()).every((r) => r.ranking_points === 0 && r.matches_played === 0)).toBe(true)
  })
})

describe("league tie-break cascade and read access", () => {
  it("uses the latest opposing head-to-head result only after earlier statistics tie", async () => {
    const t = await setup()
    await result(t.category, alice, bob, [[30, 29]], "COMPLETED", "2026-11-10T09:00:00Z")
    await result(t.category, bob, alice, [[30, 29]], "COMPLETED", "2026-11-10T11:00:00Z")
    await publish(t.tournament)
    const rows = await standings()
    expect(rows.map((r) => [r.profile_id, r.rank_position, r.ranking_points, r.net_points, r.win_percentage])).toEqual([[bob, 1, 6, 0, 50], [alice, 2, 6, 0, 50]])
    const unfinished = await setup()
    await result(unfinished.category, alice, bob, [[30, 0]], "COMPLETED", "2026-11-11T09:00:00Z")
    expect(await standings()).toEqual(rows)
  })
  it("shares a rank for a circular three-player tie instead of applying head-to-head", async () => {
    const t = await setup(undefined, false, [alice, bob, carol])
    await result(t.category, alice, bob, [[30, 29]], "COMPLETED", "2026-11-10T09:00:00Z")
    await result(t.category, bob, carol, [[30, 29]], "COMPLETED", "2026-11-10T11:00:00Z")
    await result(t.category, carol, alice, [[30, 29]], "COMPLETED", "2026-11-10T13:00:00Z")
    await publish(t.tournament)
    expect((await standings()).map((r) => [r.rank_position, r.ranking_points, r.net_points])).toEqual([[1, 6, 0], [1, 6, 0], [1, 6, 0]])
  })
  it("shares tied positions when players have no head-to-head and skips occupied places", async () => {
    const t = await setup(undefined, false, [alice, bob, carol, dan])
    await result(t.category, alice, carol, [[30, 20]])
    await result(t.category, bob, dan, [[30, 20]])
    await publish(t.tournament)
    expect((await standings()).map((r) => r.rank_position)).toEqual([1, 1, 3, 3])
  })
  it("orders tied points by net points, then wins, then fixed-precision win percentage", async () => {
    await setup(undefined, false, [alice, bob, carol, dan, erin])
    // Controlled accumulator fixtures isolate the sorting cascade from scoring.
    const stats = [[alice, 7, 4, 5], [bob, 9, 2, 4], [carol, 9, 3, 4], [dan, 9, 3, 6], [erin, 9, 3, 8]]
    for (const [player, np, wins, played] of stats) await db.query("INSERT INTO public.global_rankings(profile_id,ranking_points,net_points,matches_won,matches_played) VALUES($1,20,$2,$3,$4)", [player, np, wins, played])
    const rows = await standings()
    expect(rows.map((r) => r.profile_id)).toEqual([carol, dan, erin, bob, alice])
    expect(rows.map((r) => r.win_percentage)).toEqual([75, 50, 37.5, 50, 80])
  })
  it("denies anonymous reads, private calculation calls and player edits to ranking counters", async () => {
    await setup()
    await actor("")
    await db.exec("SET ROLE anon")
    await rejection(() => db.query("SELECT * FROM public.get_league_standings()"))
    await actor(alice)
    await rejection(() => db.query("SELECT * FROM private.ranking_match_lines(null)"))
    await rejection(() => db.query("UPDATE public.global_rankings SET ranking_points=9999"))
    expect((await standings()).every((r) => r.ranking_points === 0)).toBe(true)
  })
})
