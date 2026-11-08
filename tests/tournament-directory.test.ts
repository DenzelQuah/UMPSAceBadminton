// Tournament discovery must show authorized draft/published/history rows and refresh from the server.
import { beforeEach, describe, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({ requireAuthenticated: vi.fn(), from: vi.fn(), select: vi.fn(), order: vi.fn(), eq: vi.fn() }))
vi.mock("@/lib/auth/authorization", () => ({ requireAuthenticated: mocks.requireAuthenticated, requireCommittee: vi.fn() }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
import { getVisibleTournaments } from "../app/actions/tournaments"

beforeEach(() => {
  vi.clearAllMocks()
  const query = { select: mocks.select, order: mocks.order, eq: mocks.eq }
  mocks.from.mockReturnValue(query); mocks.select.mockReturnValue(query); mocks.eq.mockReturnValue(query)
  mocks.requireAuthenticated.mockResolvedValue({ ok: true, userId: "manager", supabase: { from: mocks.from } })
})
describe("server-rendered tournament directory", () => {
  it("keeps every RLS-authorized lifecycle state and shows newest events first", async () => {
    const rows = [{ id: "draft", status: "DRAFT" }, { id: "published", status: "DRAW_PUBLISHED" }, { id: "open", status: "REGISTRATION_OPEN" }, { id: "history", status: "COMPLETED" }]
    mocks.order.mockResolvedValue({ data: rows, error: null })
    expect(await getVisibleTournaments()).toEqual({ success: true, data: rows })
    expect(mocks.order).toHaveBeenCalledWith("created_at", { ascending: false })
    expect(mocks.eq).not.toHaveBeenCalled()
  })
  it("requires a valid session instead of fetching tournament records anonymously", async () => {
    mocks.requireAuthenticated.mockResolvedValue({ ok: false, response: { success: false, error: { code: "UNAUTHORIZED", status: 401, message: "Sign in" } } })
    expect(await getVisibleTournaments()).toMatchObject({ success: false, error: { status: 401 } })
    expect(mocks.from).not.toHaveBeenCalled()
  })
})
