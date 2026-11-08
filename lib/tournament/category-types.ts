export const GAME_TYPE_IDS = ["MEN_SINGLES", "MEN_DOUBLES", "WOMEN_DOUBLES", "WOMEN_SINGLES", "MIXED_DOUBLES", "THREE_V_THREE"] as const
export type GameType = (typeof GAME_TYPE_IDS)[number]

export const GAME_TYPES: readonly { id: GameType; label: string; participationFormat: "SINGLES" | "DOUBLES" | null }[] = [
  { id: "MEN_SINGLES", label: "Men's Singles", participationFormat: "SINGLES" },
  { id: "MEN_DOUBLES", label: "Men's Doubles", participationFormat: "DOUBLES" },
  { id: "WOMEN_DOUBLES", label: "Women's Doubles", participationFormat: "DOUBLES" },
  { id: "WOMEN_SINGLES", label: "Women's Singles", participationFormat: "SINGLES" },
  { id: "MIXED_DOUBLES", label: "Mixed Doubles", participationFormat: "DOUBLES" },
  { id: "THREE_V_THREE", label: "3 v 3", participationFormat: null },
]

export function getGameType(id: GameType) {
  const type = GAME_TYPES.find((type) => type.id === id)
  if (!type) throw new Error("Unknown game type.")
  return type
}
