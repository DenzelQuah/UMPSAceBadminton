import { beforeEach, describe, expect, it, vi } from "vitest"
import { GAME_TYPES, getGameType } from "../lib/tournament/category-types"

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), requireCommittee: vi.fn(), revalidatePath: vi.fn() }))
vi.mock("@/lib/auth/authorization", () => ({ requireCommittee: mocks.requireCommittee, requireAuthenticated: vi.fn() }))
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }))
import { createCategory } from "../app/actions/categories"

const base = {
  tournamentId: "00000000-0000-4000-8000-000000000001",
  format: "STANDARD_3X21" as const,
  maxCapacity: 16, groupCount: 4, qualifiersPerGroup: 2,
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireCommittee.mockResolvedValue({ ok: true, supabase: { rpc: mocks.rpc }, userId: "admin" })
  mocks.rpc.mockResolvedValue({ data: { id: "category", name: "Test category" }, error: null })
})

describe("administrator game type dropdown", () => {
  it("lists all six requested options", () => {
    expect(GAME_TYPES.map((type) => type.label)).toEqual(["Men's Singles", "Men's Doubles", "Women's Doubles", "Women's Singles", "Mixed Doubles", "3 v 3"])
  })
  it.each(GAME_TYPES.filter((type) => type.participationFormat !== null))("derives the name and entry size for $label on the server", async (type) => {
    const response = await createCategory({ ...base, gameType: type.id })
    expect(response.success).toBe(true)
    expect(mocks.rpc).toHaveBeenCalledWith(type.participationFormat === "DOUBLES" ? "create_doubles_category" : "create_tournament_category", expect.objectContaining({ category_name: type.label }))
  })
  it("rejects 3 v 3 without sending a singles or doubles mutation", async () => {
    expect(getGameType("THREE_V_THREE").participationFormat).toBeNull()
    expect(await createCategory({ ...base, gameType: "THREE_V_THREE" })).toMatchObject({ success: false, error: { code: "VALIDATION_ERROR" } })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it("creates a dynamic elimination category without requiring a preset group count",async()=>{
    const response=await createCategory({ tournamentId:base.tournamentId,gameType:"MEN_SINGLES",format:base.format,maxCapacity:64,qualifiersPerGroup:1,drawFormat:"SINGLE_ELIMINATION",targetGroupSize:4 })
    expect(response.success).toBe(true)
    expect(mocks.rpc).toHaveBeenCalledWith("create_dynamic_category",expect.objectContaining({ entry_format:"SINGLES",draw_format_value:"SINGLE_ELIMINATION",target_group_size_value:4,category_capacity:64 }))
    expect(mocks.rpc.mock.calls[0][1]).not.toHaveProperty("category_group_count")
  })
  it("requires administrator authorization before creating any preset", async () => {
    mocks.requireCommittee.mockResolvedValue({ ok: false, response: { success: false, error: { code: "AUTH_FORBIDDEN", status: 403, message: "Administrator access required." } } })
    expect(await createCategory({ ...base, gameType: "MEN_SINGLES" })).toMatchObject({ success: false, error: { code: "AUTH_FORBIDDEN" } })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
})
