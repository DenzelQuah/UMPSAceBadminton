// Legacy read compatibility must never bypass RLS or downgrade doubles entries.
import { describe, expect, it, vi } from "vitest"
import { categoryEntries, nameMatchSides } from "../lib/tournament/entries"
import { isLegacySinglesSchema, playerRegistrations } from "../lib/supabase/schema"
import type { Match } from "../app/(dashboard)/tournaments/types"

type Client = Parameters<typeof categoryEntries>[0]
function query(result: object) {
  const chain = {
    select: vi.fn(), limit: vi.fn(), in: vi.fn(), neq: vi.fn(), eq: vi.fn(), order: vi.fn(),
    then(resolve: (value: object) => unknown) { return Promise.resolve(result).then(resolve) },
  }
  for (const method of [chain.select, chain.limit, chain.in, chain.neq, chain.eq, chain.order]) method.mockReturnValue(chain)
  return chain
}
const missingFunction = { code: "PGRST202" }
const missingColumn = { code: "42703" }
const fixture = { category_id: "category", player_id: "player", player: { full_name: "Player A" } }

describe("tournament read compatibility", () => {
  it("uses the protected entry RPC when installed", async () => {
    const entries = [{ category_id: "category", representative_id: "player", partner_id: "partner", display_name: "Player A / Partner B" }]
    const client = { rpc: vi.fn().mockResolvedValue({ data: entries, error: null }), from: vi.fn() }
    expect(await categoryEntries(client as unknown as Client, ["category", "category"])).toEqual({ success: true, data: entries })
    expect(client.rpc).toHaveBeenCalledWith("get_category_entries", { category_ids: ["category"] })
    expect(client.from).not.toHaveBeenCalled()
  })
  it("loads authorized singles names when both the new RPC and doubles column are absent", async () => {
    const probe = query({ data: null, error: missingColumn })
    const fallback = query({ data: [fixture], error: null })
    const client = { rpc: vi.fn().mockResolvedValue({ error: missingFunction }), from: vi.fn().mockReturnValueOnce(probe).mockReturnValueOnce(fallback) }
    expect(await categoryEntries(client as unknown as Client, ["category"])).toEqual({ success: true, data: [{ category_id: "category", representative_id: "player", partner_id: null, display_name: "Player A" }] })
    expect(fallback.in).toHaveBeenCalledWith("category_id", ["category"])
    expect(fallback.neq).toHaveBeenCalledWith("status", "WITHDRAWN")
  })
  it("reports setup required when doubles columns exist but the entry RPC is missing", async () => {
    const client = { rpc: vi.fn().mockResolvedValue({ error: missingFunction }), from: vi.fn().mockReturnValue(query({ data: [], error: null })) }
    expect(await categoryEntries(client as unknown as Client, ["category"])).toMatchObject({ success: false, error: { code: "DATABASE_SETUP_REQUIRED", status: 503 } })
    expect(client.from).toHaveBeenCalledTimes(1)
  })
  it("does not turn an RLS error into a legacy read", async () => {
    const client = { rpc: vi.fn().mockResolvedValue({ error: { code: "42501" } }), from: vi.fn() }
    expect(await categoryEntries(client as unknown as Client, ["category"])).toMatchObject({ success: false, error: { code: "AUTH_FORBIDDEN", status: 403 } })
    expect(client.from).not.toHaveBeenCalled()
  })
  it("does not treat a forbidden schema probe as proof of a singles database", async () => {
    const client = { from: vi.fn().mockReturnValue(query({ error: { code: "42501" } })) }
    expect(await isLegacySinglesSchema(client as unknown as Client)).toMatchObject({ success: false, error: { code: "AUTH_FORBIDDEN" } })
  })
  it("does not treat an incomplete schema cache as proof that doubles is absent", async () => {
    const client = { from: vi.fn().mockReturnValue(query({ error: { code: "PGRST204" } })) }
    expect(await isLegacySinglesSchema(client as unknown as Client)).toMatchObject({ success: false, error: { code: "DATABASE_SETUP_REQUIRED" } })
  })
  it("returns a structured database error instead of throwing a workspace exception", async () => {
    const client = { rpc: vi.fn().mockResolvedValue({ error: { code: "XX000" } }), from: vi.fn() }
    expect(await nameMatchSides(client as unknown as Client, [{ category_id: "category" } as Match])).toMatchObject({ success: false, error: { code: "DATABASE_ERROR" } })
    expect(client.from).not.toHaveBeenCalled()
  })
  it("keeps the legacy registration fallback scoped to the authenticated player", async () => {
    const probe = query({ error: missingColumn })
    const registrations = [{ id: "registration", player_id: "player", category_id: "category", status: "CONFIRMED" }]
    const fallback = query({ data: registrations, error: null })
    const client = { rpc: vi.fn().mockResolvedValue({ error: missingFunction }), from: vi.fn().mockReturnValueOnce(probe).mockReturnValueOnce(fallback) }
    expect(await playerRegistrations(client as unknown as Client, "player")).toEqual({ success: true, data: registrations })
    expect(fallback.eq).toHaveBeenCalledWith("player_id", "player")
  })
  it("never hides partner registrations on a partially installed doubles schema", async () => {
    const client = { rpc: vi.fn().mockResolvedValue({ error: missingFunction }), from: vi.fn().mockReturnValue(query({ error: null, data: [] })) }
    expect(await playerRegistrations(client as unknown as Client, "partner")).toMatchObject({ success: false, error: { code: "DATABASE_SETUP_REQUIRED" } })
    expect(client.from).toHaveBeenCalledTimes(1)
  })
})
