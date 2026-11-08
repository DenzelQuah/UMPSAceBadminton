import { beforeEach, afterEach, describe, expect, it, vi } from "vitest"
import { canManageTournaments, isApprovedStaff } from "../lib/auth/organizational-roles"
import { readActorProfile } from "../lib/auth/actor-profile"
const mocks = vi.hoisted(() => ({ signUp: vi.fn() }))
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({ auth: { signUp: mocks.signUp } })) }))
import { registerWithDomain } from "../app/actions/auth"

beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("ALLOW_NON_UMPSA_AUTH", "false")
  mocks.signUp.mockResolvedValue({ data: { user: { id: "new-user" }, session: null }, error: null })
})
afterEach(() => { vi.unstubAllEnvs() })
const account = { email: "new-member@adab.umpsa.edu.my", password: "test-password", fullName: "New member" }
describe("organization signup and approved capabilities", () => {
  it.each(["MT", "EXCO", "AJK"] as const)("records a %s request without putting privileges into signup metadata", async (role) => {
    expect((await registerWithDomain({ ...account, requestedRole: role, roleDetail: "Technical" })).success).toBe(true)
    const metadata = mocks.signUp.mock.calls[0][0].options.data
    expect(metadata.requested_organizational_role).toBe(role)
    expect(metadata).not.toHaveProperty("is_admin")
    expect(metadata).not.toHaveProperty("organizational_role")
  })
  it("rejects a committee request without a position or team", async () => {
    expect(await registerWithDomain({ ...account, requestedRole: "MT" })).toMatchObject({ success: false, error: { code: "VALIDATION_ERROR" } })
    expect(mocks.signUp).not.toHaveBeenCalled()
  })
  it("keeps player signup free of committee approval requirements", async () => {
    expect((await registerWithDomain(account)).success).toBe(true)
    expect(mocks.signUp.mock.calls[0][0].options.data.requested_organizational_role).toBe("PLAYER")
  })
  it("grants management only to approved MT or an administrator", () => {
    expect(canManageTournaments({ organizational_role: "MT", is_admin: false })).toBe(true)
    expect(canManageTournaments({ organizational_role: "EXCO", is_admin: false })).toBe(false)
    expect(canManageTournaments({ organizational_role: "PLAYER", is_admin: true })).toBe(true)
    expect(isApprovedStaff({ organizational_role: "AJK" })).toBe(true)
    expect(isApprovedStaff({ organizational_role: "PLAYER" })).toBe(false)
  })
  it("preserves existing approved administrators on databases awaiting the new migration", async () => {
    const client = { rpc: vi.fn().mockResolvedValueOnce({ data: null, error: { code: "PGRST202" } }).mockResolvedValueOnce({ data: null, error: { code: "PGRST202" } }).mockResolvedValueOnce({ data: [{ id: "admin", is_admin: true }], error: null }) }
    const profile = await readActorProfile(client as unknown as Parameters<typeof readActorProfile>[0])
    expect(canManageTournaments(profile.data)).toBe(true)
    expect(profile.data?.role_model_available).toBe(false)
    expect(client.rpc).toHaveBeenNthCalledWith(3, "current_user_profile")
  })
  it("does not bypass a forbidden actor-profile RPC using legacy role data", async () => {
    const client = { rpc: vi.fn().mockResolvedValue({ data: null, error: { code: "42501" } }) }
    expect((await readActorProfile(client as unknown as Parameters<typeof readActorProfile>[0])).error?.code).toBe("42501")
    expect(client.rpc).toHaveBeenCalledTimes(1)
  })
  it("preserves approved MT while the tournament-role migration is pending", async () => {
    const client = { rpc:vi.fn().mockResolvedValueOnce({ data:null,error:{ code:"PGRST202" } }).mockResolvedValueOnce({ data:[{ id:"mt",is_admin:false,organizational_role:"MT" }],error:null }) }
    const profile = await readActorProfile(client as unknown as Parameters<typeof readActorProfile>[0])
    expect(canManageTournaments(profile.data)).toBe(true)
    expect(profile.data).toMatchObject({ role_model_available:true,tournament_roles_available:false,user_role:"MT" })
    expect(client.rpc).toHaveBeenCalledTimes(2)
  })
  it("keeps tournament AJK state separate from global organization access", async () => {
    const client = { rpc:vi.fn().mockResolvedValue({ data:[{ id:"ajk",is_admin:false,organizational_role:"PLAYER",user_role:"AJK",tournament_ajk_ids:["event"],authorized_umpire_match_ids:["match"] }],error:null }) }
    const profile = await readActorProfile(client as unknown as Parameters<typeof readActorProfile>[0])
    expect(profile.data).toMatchObject({ user_role:"AJK",organizational_role:"PLAYER",tournament_roles_available:true,tournament_ajk_ids:["event"],authorized_umpire_match_ids:["match"] })
    expect(canManageTournaments(profile.data)).toBe(false)
    expect(isApprovedStaff(profile.data)).toBe(true)
  })
})
