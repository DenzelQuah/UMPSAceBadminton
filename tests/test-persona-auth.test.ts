// docs/user-roles.md §2.2: a test persona label never grants administrator access.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const client = vi.hoisted(() => ({
  auth: { signInWithPassword: vi.fn(), signOut: vi.fn() },
  rpc: vi.fn(),
}))
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => client) }))
import { loginWithTestPersona } from "../app/actions/auth"

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv("NODE_ENV", "test")
  vi.stubEnv("TEST_AUTH_MODE", "true")
  vi.stubEnv("TEST_ADMIN_EMAIL", "test-admin@umpsa.edu.my")
  vi.stubEnv("TEST_ADMIN_PASSWORD", "test-password")
  vi.stubEnv("TEST_PLAYER01_EMAIL", "test-player@umpsa.edu.my")
  vi.stubEnv("TEST_PLAYER01_PASSWORD", "test-password")
  client.auth.signInWithPassword.mockResolvedValue({ data: { user: { id: "test-user" } }, error: null })
  client.auth.signOut.mockResolvedValue({ error: null })
  client.rpc.mockResolvedValue({ data: [{ is_admin: true }], error: null })
})
afterEach(() => { vi.unstubAllEnvs() })

describe("development Administrator sign-in", () => {
  it("accepts an explicitly approved administrator", async () => {
    expect((await loginWithTestPersona({ persona: "admin" })).success).toBe(true)
    expect(client.rpc).toHaveBeenCalledWith("current_user_profile")
    expect(client.auth.signOut).not.toHaveBeenCalled()
  })
  it("rejects a regular player mislabeled as Administrator and clears only that session", async () => {
    client.rpc.mockResolvedValue({ data: [{ is_admin: false }], error: null })
    expect(await loginWithTestPersona({ persona: "admin" })).toMatchObject({ success: false, error: { code: "AUTH_FORBIDDEN", status: 403 } })
    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: "local" })
  })
  it("fails closed if the administrator profile cannot be loaded", async () => {
    client.rpc.mockResolvedValue({ data: null, error: { code: "PGRST202" } })
    expect(await loginWithTestPersona({ persona: "admin" })).toMatchObject({ success: false, error: { code: "DATABASE_ERROR", status: 503 } })
    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: "local" })
  })
  it("keeps regular player sign-in independent of administrator privileges", async () => {
    expect((await loginWithTestPersona({ persona: "player-01" })).success).toBe(true)
    expect(client.rpc).not.toHaveBeenCalled()
  })
  it("never enables test personas in production", async () => {
    vi.stubEnv("NODE_ENV", "production")
    expect(await loginWithTestPersona({ persona: "admin" })).toMatchObject({ success: false, error: { status: 404 } })
    expect(client.auth.signInWithPassword).not.toHaveBeenCalled()
  })
})
