export const TEST_PERSONAS = [
  { id: "player-01", label: "Player 01", redirect: "/tournaments" },
  { id: "player-02", label: "Player 02", redirect: "/tournaments" },
  { id: "player-03", label: "Player 03", redirect: "/tournaments" },
  { id: "player-04", label: "Player 04", redirect: "/tournaments" },
  { id: "mt", label: "MT", redirect: "/dashboard" },
  { id: "exco", label: "EXCO", redirect: "/dashboard" },
  { id: "ajk", label: "AJK", redirect: "/dashboard" },
  { id: "admin", label: "Administrator", redirect: "/admin" },
] as const

export type TestPersona = (typeof TEST_PERSONAS)[number]["id"] | "umpire" | "linesman"

export const TEST_PERSONA_LABELS = { ...Object.fromEntries(TEST_PERSONAS.map((persona) => [persona.id, persona.label])), umpire: "MT", linesman: "EXCO" } as Record<TestPersona, string>
