const UMPSA_EMAIL_PATTERN = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@(adab\.)?umpsa\.edu\.my$/i
const STUDENT_EMAIL_PATTERN = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@adab\.umpsa\.edu\.my$/i
const STAFF_EMAIL_PATTERN = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@umpsa\.edu\.my$/i

import { isBackupManagerEmail } from "./backup-manager"

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function isUmpEmail(email: string): boolean {
  return UMPSA_EMAIL_PATTERN.test(normalizeEmail(email))
}

export function isStudentEmail(email: string): boolean {
  return STUDENT_EMAIL_PATTERN.test(normalizeEmail(email))
}

export function isStaffEmail(email: string): boolean {
  return STAFF_EMAIL_PATTERN.test(normalizeEmail(email))
}

export function institutionalDomainsAllowed(): boolean {
  return process.env.ALLOW_NON_UMPSA_AUTH === "true"
}

export function canAuthenticateEmail(email: string): boolean {
  return institutionalDomainsAllowed() || isUmpEmail(email) || isBackupManagerEmail(email)
}

export function safeRedirectPath(value: string | null | undefined, fallback = "/dashboard"): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return fallback
  }

  try {
    const parsed = new URL(value, "https://umpsace.local")
    if (parsed.origin !== "https://umpsace.local") return fallback
    return `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch {
    return fallback
  }
}
