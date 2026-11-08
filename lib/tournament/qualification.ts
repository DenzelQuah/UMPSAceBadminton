import type { BracketSeed } from "./bracket"

/** All winners first, then runners-up, preserving natural group order. */
export function orderQualifiers(seeds: BracketSeed[]): BracketSeed[] {
  return [...seeds]
    .sort((a, b) => a.place - b.place || a.groupName.localeCompare(b.groupName, "en", { numeric: true }))
    .map((seed, index) => ({ ...seed, seed: index + 1 }))
}
