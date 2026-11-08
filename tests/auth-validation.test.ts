import { afterEach, describe, expect, it } from "vitest"

import {
  canAuthenticateEmail,
  isStaffEmail,
  isStudentEmail,
  isUmpEmail,
  safeRedirectPath,
} from "../lib/auth/validation"

const originalAllowNonUmp = process.env.ALLOW_NON_UMPSA_AUTH

afterEach(() => {
  if (originalAllowNonUmp === undefined) {
    delete process.env.ALLOW_NON_UMPSA_AUTH
  } else {
    process.env.ALLOW_NON_UMPSA_AUTH = originalAllowNonUmp
  }
})

describe("institutional authentication", () => {
  it("accepts normalized student and staff UMPSA addresses", () => {
    expect(isUmpEmail(" Player@ADAB.UMPSA.EDU.MY ")).toBe(true)
    expect(isStudentEmail("player@adab.umpsa.edu.my")).toBe(true)
    expect(isStaffEmail("staff@umpsa.edu.my")).toBe(true)
  })

  it("rejects consumer and lookalike domains", () => {
    expect(isUmpEmail("player@gmail.com")).toBe(false)
    expect(isUmpEmail("player@umpsa.edu.my.evil.com")).toBe(false)
    expect(isUmpEmail("player@evilumpsa.edu.my")).toBe(false)
  })

  it("only allows non-UMPSA addresses when explicitly enabled", () => {
    delete process.env.ALLOW_NON_UMPSA_AUTH
    expect(canAuthenticateEmail("test@example.com")).toBe(false)

    process.env.ALLOW_NON_UMPSA_AUTH = "true"
    expect(canAuthenticateEmail("test@example.com")).toBe(true)
  })

  it("keeps post-login redirects on the local application", () => {
    expect(safeRedirectPath("/admin/tournaments/123?tab=draws")).toBe(
      "/admin/tournaments/123?tab=draws"
    )
    expect(safeRedirectPath("https://evil.example/admin")).toBe("/dashboard")
    expect(safeRedirectPath("//evil.example/admin")).toBe("/dashboard")
  })
  it("allows exactly the owner-approved backup address through the domain check",()=>{
    delete process.env.ALLOW_NON_UMPSA_AUTH
    expect(canAuthenticateEmail(" ProDenzel992@Gmail.com ")).toBe(true)
    expect(canAuthenticateEmail("prodenzel992+other@gmail.com")).toBe(false)
    expect(canAuthenticateEmail("other@gmail.com")).toBe(false)
  })
})
